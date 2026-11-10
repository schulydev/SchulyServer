using Schuly.Infrastructure.Services;
using Schuly.Plugin.Abstractions.Linking;

namespace Schuly.API.Linking
{
    public enum LinkOutcome { Ok, NotFound, BadRequest, BadGateway }

    public sealed record LinkResult<T>(LinkOutcome Outcome, T? Value, LinkErrorDto? Error = null)
    {
        public static LinkResult<T> Ok(T value) => new(LinkOutcome.Ok, value);
        public static LinkResult<T> NotFound(string message = "Not found.") => new(LinkOutcome.NotFound, default, new LinkErrorDto(message, null));
        public static LinkResult<T> BadRequest(string message, List<string>? errors = null) => new(LinkOutcome.BadRequest, default, new LinkErrorDto(message, errors));
        public static LinkResult<T> BadGateway(string message) => new(LinkOutcome.BadGateway, default, new LinkErrorDto(message, null));
        public bool IsOk => Outcome == LinkOutcome.Ok;
    }

    /// <summary>
    /// Generic account-linking host: drives whatever ILinkProvider the loaded plugins declare. It validates every step
    /// the plugin returns and every submit the client sends, and never stores, logs or echoes submitted values.
    /// </summary>
    public sealed class LinkingService(ILinkProviderCatalog catalog, LinkSessionStore sessions, TimeProvider time, ILogger<LinkingService> logger, IServiceScopeFactory? scopes = null)
    {
        public const string GenericFailure = "The sign-in could not be completed. Please try again.";
        public const string ExpiredMessage = "This sign-in expired. Please start again.";
        private const int MaxCallbackValues = 20;
        private const int MaxCallbackValueLength = 4096;
        private static readonly TimeSpan ListTimeout = TimeSpan.FromSeconds(20);

        public IReadOnlyList<LinkProviderDto> GetProviders(LinkPlatform platform) =>
            catalog.Providers
                .Select(e => LinkDtoMapper.ToDto(e, platform))
                .Where(p => p.Flows.Count > 0)
                .OrderBy(p => p.SortOrder)
                .ThenBy(p => p.DisplayName, StringComparer.OrdinalIgnoreCase)
                .ToList();

        public (string Svg, string Version)? GetIcon(string providerId) =>
            catalog.Find(providerId) is { Svg: { } svg, SvgVersion: { } version } ? (svg, version) : null;

        public async Task<LinkResult<LinkSessionDto>> StartAsync(Guid userId, string providerId, string? flowId, LinkPlatform platform, string? reauthAccountId, string hostCallbackBase, CancellationToken ct)
        {
            if (catalog.Find(providerId) is not { } entry)
                return LinkResult<LinkSessionDto>.NotFound("Unknown provider.");

            var allowed = entry.Descriptor.Flows.Where(f => LinkDtoMapper.AllowedOn(f, platform)).ToList();
            var flow = string.IsNullOrEmpty(flowId) ? allowed.FirstOrDefault() : allowed.FirstOrDefault(f => f.Id == flowId);
            if (flow is null)
                return LinkResult<LinkSessionDto>.BadRequest("This provider has no sign-in flow for this platform.");
            if (reauthAccountId is { Length: > 200 })
                return LinkResult<LinkSessionDto>.BadRequest("Invalid account id.");

            var id = LinkSessionStore.NewId();
            var callbackUrl = $"{hostCallbackBase}?session={id}";
            using var lease = catalog.Open(providerId);
            if (lease is null)
                return LinkResult<LinkSessionDto>.NotFound("Unknown provider.");

            LinkStepResult? result;
            try
            {
                result = await lease.Provider.StartAsync(new LinkStartContext(userId, flow.Id, platform, reauthAccountId, callbackUrl), ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogPluginFailure(providerId, "start", ex);
                result = null;
            }

            var session = sessions.Create(id, userId, providerId, flow.Id, platform, reauthAccountId, callbackUrl);
            return LinkResult<LinkSessionDto>.Ok(Apply(session, result, retainTerminal: false));
        }

        public async Task<LinkResult<LinkSessionDto>> SubmitAsync(Guid userId, string sessionId, SubmitLinkRequest request, CancellationToken ct)
        {
            if (sessions.Get(sessionId, userId) is not { } session)
                return LinkResult<LinkSessionDto>.NotFound("Unknown sign-in session.");

            await session.Gate.WaitAsync(ct);
            try
            {
                if (Expired(session) is { } expired)
                    return LinkResult<LinkSessionDto>.Ok(expired);

                if (session.Status != LinkSessionStatus.Active)
                    return LinkResult<LinkSessionDto>.Ok(Terminal(session));

                if (!string.Equals(request.StepId, session.Step.Id, StringComparison.Ordinal))
                    return LinkResult<LinkSessionDto>.BadRequest("This step is no longer current.");

                var values = request.Values ?? new Dictionary<string, string>();
                var validation = LinkStepValidator.Validate(session.Step, values, request.Action);
                if (!validation.IsValid)
                    return LinkResult<LinkSessionDto>.BadRequest("The submitted values are not valid.", validation.Errors.ToList());

                if (request.Action == LinkStepValidator.CancelAction)
                    return LinkResult<LinkSessionDto>.Ok(Cancel(session));

                return LinkResult<LinkSessionDto>.Ok(await CallSubmitAsync(session, values, request.Action, retainTerminal: false, ct));
            }
            finally
            {
                session.Gate.Release();
            }
        }

        public async Task<LinkResult<LinkSessionDto>> GetAsync(Guid userId, string sessionId, CancellationToken ct)
        {
            if (sessions.Get(sessionId, userId) is not { } session)
                return LinkResult<LinkSessionDto>.NotFound("Unknown sign-in session.");

            await session.Gate.WaitAsync(ct);
            try
            {
                if (Expired(session) is { } expired)
                    return LinkResult<LinkSessionDto>.Ok(expired);

                if (session.Status != LinkSessionStatus.Active)
                    return LinkResult<LinkSessionDto>.Ok(Terminal(session));

                var polled = session.Step.Kind is LinkStepKind.PushCode or LinkStepKind.DeviceCode;
                if (!polled || time.GetUtcNow() < session.LastPollAt + PollInterval(session.Step))
                    return LinkResult<LinkSessionDto>.Ok(ToDto(session));

                session.LastPollAt = time.GetUtcNow();
                LinkStepResult? result;
                try
                {
                    using var lease = catalog.Open(session.ProviderId);
                    result = lease is null
                        ? null
                        : await lease.Provider.PollAsync(new LinkPollContext(session.UserId, session.FlowId, session.Platform, session.Step.Id, sessions.Unprotect(session.ProtectedState), session.ReauthAccountId), ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    LogPluginFailure(session.ProviderId, "poll", ex);
                    result = null;
                }

                return LinkResult<LinkSessionDto>.Ok(Apply(session, result, retainTerminal: false));
            }
            finally
            {
                session.Gate.Release();
            }
        }

        public bool Cancel(Guid userId, string sessionId)
        {
            if (sessions.Get(sessionId, userId) is not { } session)
                return false;

            sessions.Remove(session.Id);
            return true;
        }

        /// <summary>Anonymous browser return: the session id is the capability. Returns the session id to show, or null when unknown.</summary>
        public async Task<string?> CompleteCallbackAsync(string sessionId, IReadOnlyDictionary<string, string> query, CancellationToken ct)
        {
            if (string.IsNullOrEmpty(sessionId) || sessions.GetByCapability(sessionId) is not { } session)
                return null;

            await session.Gate.WaitAsync(ct);
            try
            {
                if (Expired(session) is not null || session.Status != LinkSessionStatus.Active)
                    return session.Id;

                if (query.Count > MaxCallbackValues || query.Any(kv => kv.Key.Length > 64 || kv.Value.Length > MaxCallbackValueLength))
                {
                    Apply(session, null, retainTerminal: true);
                    return session.Id;
                }

                await CallSubmitAsync(session, query, "callback", retainTerminal: true, ct);
                return session.Id;
            }
            finally
            {
                session.Gate.Release();
            }
        }

        /// <param name="withPictures">Adds each account's signed picture URL; only for the owner's own live view, never for exports.</param>
        public async Task<IReadOnlyList<LinkProviderAccountDto>> ListAccountsAsync(Guid userId, CancellationToken ct, bool withPictures = false)
        {
            var tasks = catalog.Providers.Select(entry => ListOneAsync(entry, userId, ct)).ToList();
            var rows = (await Task.WhenAll(tasks)).SelectMany(l => l).ToList();
            if (!withPictures || scopes is null)
                return rows.Select(r => r.Dto).ToList();

            var schoolUserIds = rows.Where(r => r.SchoolUserId is not null).Select(r => r.SchoolUserId!.Value).Distinct().ToList();
            var linkedAccountIds = rows.Where(r => r.LinkedAccountId is not null).Select(r => r.LinkedAccountId!.Value).Distinct().ToList();
            if (schoolUserIds.Count == 0 && linkedAccountIds.Count == 0)
                return rows.Select(r => r.Dto).ToList();

            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var pictures = await scope.ServiceProvider.GetRequiredService<AccountPictureUrls>().ResolveAsync(userId, schoolUserIds, linkedAccountIds, ct);
                return rows.Select(r => r.Dto with { PictureUrl = pictures.For(r.SchoolUserId, r.LinkedAccountId) }).ToList();
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Pictures are decoration: the list still loads without them.
                logger.LogWarning("Account pictures could not be resolved ({ExceptionType})", ex.GetType().Name);
                return rows.Select(r => r.Dto).ToList();
            }
        }

        private sealed record AccountRow(LinkProviderAccountDto Dto, Guid? SchoolUserId, Guid? LinkedAccountId);

        public async Task<LinkResult<bool>> UnlinkAsync(Guid userId, string providerId, string accountId, CancellationToken ct)
        {
            using var lease = catalog.Open(providerId);
            if (lease is null || accountId.Length > 200)
                return LinkResult<bool>.NotFound("Account not found.");

            try
            {
                return await lease.Provider.UnlinkAsync(userId, accountId, ct)
                    ? LinkResult<bool>.Ok(true)
                    : LinkResult<bool>.NotFound("Account not found.");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogPluginFailure(providerId, "unlink", ex);
                return LinkResult<bool>.BadGateway("The account could not be removed. Please try again.");
            }
        }

        private async Task<LinkSessionDto> CallSubmitAsync(LinkSession session, IReadOnlyDictionary<string, string> values, string? action, bool retainTerminal, CancellationToken ct)
        {
            LinkStepResult? result;
            try
            {
                using var lease = catalog.Open(session.ProviderId);
                result = lease is null
                    ? null
                    : await lease.Provider.SubmitAsync(new LinkSubmitContext(session.UserId, session.FlowId, session.Platform, session.Step.Id, sessions.Unprotect(session.ProtectedState), values, action, session.ReauthAccountId, session.HostCallbackUrl), ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogPluginFailure(session.ProviderId, "submit", ex);
                result = null;
            }

            return Apply(session, result, retainTerminal);
        }

        /// <summary>Validates a plugin result, moves the session on and returns the DTO. A null or invalid result fails the session.</summary>
        private LinkSessionDto Apply(LinkSession session, LinkStepResult? result, bool retainTerminal)
        {
            var step = result?.Step;
            if (step is not null)
            {
                var validation = LinkDescriptorValidator.ValidateStep(step, session.Platform);
                if (!validation.IsValid || (step.Kind == LinkStepKind.Done && step.Done!.AccountId.Length > 200))
                {
                    logger.LogWarning("Link provider {Provider} returned an invalid step {StepId}: {Errors}", session.ProviderId, step.Id, string.Join(" ", validation.Errors));
                    step = null;
                }
            }

            if (step is null)
                return Finish(session, LinkStepResult.Fail(GenericFailure).Step, LinkSessionStatus.Failed, retainTerminal);

            switch (step.Kind)
            {
                case LinkStepKind.Done:
                    return Finish(session, step, LinkSessionStatus.Done, retainTerminal);
                case LinkStepKind.Error:
                    return Finish(session, step, LinkSessionStatus.Failed, retainTerminal);
                default:
                    session.Step = step;
                    session.ProtectedState = sessions.Protect(result!.State);
                    session.LastPollAt = time.GetUtcNow();
                    return ToDto(session);
            }
        }

        private LinkSessionDto Finish(LinkSession session, LinkStep step, LinkSessionStatus status, bool retain)
        {
            session.Step = step;
            session.Status = status;
            session.ProtectedState = null;
            var dto = ToDto(session);
            if (retain)
                session.RetainUntil = time.GetUtcNow() + LinkSessionStore.TerminalRetention;
            else
                sessions.Remove(session.Id);
            return dto;
        }

        private LinkSessionDto Cancel(LinkSession session) =>
            Finish(session, LinkStepResult.Fail("The sign-in was cancelled.").Step, LinkSessionStatus.Failed, retain: false);

        private LinkSessionDto Terminal(LinkSession session)
        {
            var dto = ToDto(session);
            sessions.Remove(session.Id);
            return dto;
        }

        private LinkSessionDto? Expired(LinkSession session)
        {
            if (!sessions.IsExpired(session))
                return null;

            sessions.Remove(session.Id);
            if (session.Status != LinkSessionStatus.Active)
                return ToDto(session);

            return new LinkSessionDto(session.Id, session.ProviderId, session.FlowId, LinkSessionStatus.Expired, time.GetUtcNow(), LinkDtoMapper.ToDto(LinkStepResult.Fail(ExpiredMessage).Step));
        }

        private LinkSessionDto ToDto(LinkSession session) =>
            new(session.Id, session.ProviderId, session.FlowId, session.Status, session.Status == LinkSessionStatus.Active ? session.EffectiveExpiry : time.GetUtcNow(), LinkDtoMapper.ToDto(session.Step));

        private TimeSpan PollInterval(LinkStep step)
        {
            var seconds = step.PushCode?.PollIntervalSeconds ?? step.DeviceCode?.PollIntervalSeconds ?? 5;
            return TimeSpan.FromSeconds(Math.Clamp(seconds, 1, 60));
        }

        private async Task<IReadOnlyList<AccountRow>> ListOneAsync(LinkProviderEntry entry, Guid userId, CancellationToken ct)
        {
            var d = entry.Descriptor;
            var capabilities = LinkDtoMapper.ToDtos(d.Capabilities);
            var canReauth = d.Flows.Count > 0;
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(ListTimeout);
                using var lease = catalog.Open(d.Id) ?? throw new InvalidOperationException("Provider is no longer loaded.");
                var accounts = await lease.Provider.ListAccountsAsync(userId, timeout.Token);
                return accounts
                    .Select(a => new AccountRow(new LinkProviderAccountDto(d.Id, d.DisplayName, a.Id, a.Title, a.Detail, Enum.Parse<LinkedAccountStatusDto>(a.Status.ToString()), a.Message, a.LinkedAt, a.LastSyncedAt, capabilities, canReauth), a.SchoolUserId, a.LinkedAccountId))
                    .ToList();
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                LogPluginFailure(d.Id, "list", ex);
                return [new AccountRow(new LinkProviderAccountDto(d.Id, d.DisplayName, string.Empty, d.DisplayName, null, LinkedAccountStatusDto.Error, "Accounts could not be loaded right now.", null, null, capabilities, false), null, null)];
            }
        }

        // The exception message is deliberately not logged: a careless plugin could have put a submitted value in it.
        private void LogPluginFailure(string providerId, string operation, Exception ex) =>
            logger.LogError("Link provider {Provider} failed during {Operation} ({ExceptionType})", providerId, operation, ex.GetType().Name);
    }
}
