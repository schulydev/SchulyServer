using Mediator;
using Schuly.Application.Authorization;
using Schuly.Application.Dtos;
using Schuly.Application.Models;
using Schuly.Application.Queries.Mcp;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure.Mcp;
using Schuly.Infrastructure.Services;

namespace Schuly.Application.Commands.Mcp
{
    /// <summary>Connecting an AI app sends school data to a third party, so it takes its own tick on every new connection. Connections made before this stay as they are.</summary>
    internal static class McpOptIn
    {
        public const string Missing = "Confirm that this app may receive the data you allow.";
    }

    /// <summary>The signed-in user approves or denies an app. The request is validated again here, since nothing the consent page sends is trusted.</summary>
    [AllowAuthenticated]
    public record DecideMcpAuthorizationCommand(McpAuthorizationParameters Parameters, bool Approve, McpPermissionSet? Permissions, bool AiAppSharingConfirmed = false) : ICommand<Result<McpAuthorizationDecisionDto>>;

    public class DecideMcpAuthorizationCommandHandler(McpOAuthService oauth, McpPublicUrls urls, IUserService userService) : ICommandHandler<DecideMcpAuthorizationCommand, Result<McpAuthorizationDecisionDto>>
    {
        public async ValueTask<Result<McpAuthorizationDecisionDto>> Handle(DecideMcpAuthorizationCommand command, CancellationToken cancellationToken)
        {
            var request = command.Parameters.ToRequest();
            var check = await oauth.CheckAuthorizationRequestAsync(request, urls.Resource, cancellationToken);

            if (check.Status == AuthorizationRequestStatus.Fatal)
                return Result.Failure<McpAuthorizationDecisionDto>(check.ErrorDescription ?? "This authorization request is invalid.");
            if (check.Status == AuthorizationRequestStatus.Redirect)
                return Result.Success(new McpAuthorizationDecisionDto(McpRedirects.Error(check.RedirectUri!, check.Error!, check.ErrorDescription, request.State, urls.Issuer)));
            if (!command.Approve)
                return Result.Success(new McpAuthorizationDecisionDto(McpRedirects.Error(check.RedirectUri!, "access_denied", "The user denied access.", request.State, urls.Issuer)));

            if (!command.AiAppSharingConfirmed)
                return Result.Failure<McpAuthorizationDecisionDto>(McpOptIn.Missing);

            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            // The user's checklist wins over whatever the app asked for; with none, the safe default.
            var code = await oauth.ApproveAsync(userId, request, check.Resource!, command.Permissions ?? McpPermissionSet.SchoolDataOnly(), cancellationToken);
            return Result.Success(new McpAuthorizationDecisionDto(McpRedirects.Code(check.RedirectUri!, code, request.State, urls.Issuer)));
        }
    }

    /// <summary>Disconnects an app: its tokens stop working at once, the refresh token included.</summary>
    [AllowAuthenticated]
    public record RevokeMcpConnectionCommand(Guid ConnectionId) : ICommand<Result>;

    public class RevokeMcpConnectionCommandHandler(McpOAuthService oauth, IUserService userService) : ICommandHandler<RevokeMcpConnectionCommand, Result>
    {
        public async ValueTask<Result> Handle(RevokeMcpConnectionCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            return await oauth.RevokeGrantAsync(userId, command.ConnectionId, cancellationToken) ? Result.Success() : Result.Failure("Connected app not found");
        }
    }

    [AllowAuthenticated]
    public record CreateMcpApiKeyCommand(string Name, McpPermissionSet? Permissions, DateTime? ExpiresAt, bool AiAppSharingConfirmed = false) : ICommand<Result<CreatedMcpApiKeyDto>>;

    public class CreateMcpApiKeyCommandHandler(McpApiKeyService keys, IUserService userService) : ICommandHandler<CreateMcpApiKeyCommand, Result<CreatedMcpApiKeyDto>>
    {
        public async ValueTask<Result<CreatedMcpApiKeyDto>> Handle(CreateMcpApiKeyCommand command, CancellationToken cancellationToken)
        {
            if (!command.AiAppSharingConfirmed)
                return Result.Failure<CreatedMcpApiKeyDto>(McpOptIn.Missing);

            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var (created, error) = await keys.CreateAsync(userId, command.Name, command.Permissions, command.ExpiresAt, cancellationToken);
            return created is null ? Result.Failure<CreatedMcpApiKeyDto>(error!) : Result.Success(new CreatedMcpApiKeyDto(McpRedirects.ToDto(created.Key), created.Secret));
        }
    }

    /// <summary>Changes what a connected app may do. Applies to its next request; the app does not reconnect.</summary>
    [AllowAuthenticated]
    public record UpdateMcpConnectionPermissionsCommand(Guid ConnectionId, McpPermissionSet Permissions) : ICommand<Result<McpConnectionDto>>;

    public class UpdateMcpConnectionPermissionsCommandHandler(McpOAuthService oauth, IUserService userService) : ICommandHandler<UpdateMcpConnectionPermissionsCommand, Result<McpConnectionDto>>
    {
        public async ValueTask<Result<McpConnectionDto>> Handle(UpdateMcpConnectionPermissionsCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var updated = await oauth.UpdateGrantPermissionsAsync(userId, command.ConnectionId, command.Permissions, cancellationToken);
            return updated is null ? Result.Failure<McpConnectionDto>("Connected app not found") : Result.Success(McpRedirects.ToDto(updated));
        }
    }

    [AllowAuthenticated]
    public record UpdateMcpApiKeyPermissionsCommand(Guid KeyId, McpPermissionSet Permissions) : ICommand<Result<McpApiKeyDto>>;

    public class UpdateMcpApiKeyPermissionsCommandHandler(McpApiKeyService keys, IUserService userService) : ICommandHandler<UpdateMcpApiKeyPermissionsCommand, Result<McpApiKeyDto>>
    {
        public async ValueTask<Result<McpApiKeyDto>> Handle(UpdateMcpApiKeyPermissionsCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var updated = await keys.UpdatePermissionsAsync(userId, command.KeyId, command.Permissions, cancellationToken);
            return updated is null ? Result.Failure<McpApiKeyDto>("API key not found") : Result.Success(McpRedirects.ToDto(updated));
        }
    }

    [AllowAuthenticated]
    public record RevokeMcpApiKeyCommand(Guid KeyId) : ICommand<Result>;

    public class RevokeMcpApiKeyCommandHandler(McpApiKeyService keys, IUserService userService) : ICommandHandler<RevokeMcpApiKeyCommand, Result>
    {
        public async ValueTask<Result> Handle(RevokeMcpApiKeyCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            return await keys.RevokeAsync(userId, command.KeyId, cancellationToken) ? Result.Success() : Result.Failure("API key not found");
        }
    }
}
