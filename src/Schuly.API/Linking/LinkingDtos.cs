using System.Text.Json;
using System.Text.Json.Serialization;
using Schuly.Plugin.Abstractions.Linking;

namespace Schuly.API.Linking
{
    /// <summary>String enum serialized in camelCase, independent of the app-wide enum converter.</summary>
    public sealed class CamelCaseEnumConverter<T>() : JsonStringEnumConverter<T>(JsonNamingPolicy.CamelCase) where T : struct, Enum;

    [JsonConverter(typeof(CamelCaseEnumConverter<LinkSessionStatus>))]
    public enum LinkSessionStatus { Active, Done, Failed, Expired }

    [JsonConverter(typeof(CamelCaseEnumConverter<LinkStepKindDto>))]
    public enum LinkStepKindDto { Form, Otp, PushCode, DeviceCode, Redirect, Select, Done, Error }

    [JsonConverter(typeof(CamelCaseEnumConverter<LinkFieldTypeDto>))]
    public enum LinkFieldTypeDto { Text, Email, Password, Select, Url, TotpSecret }

    [JsonConverter(typeof(CamelCaseEnumConverter<LinkRedirectModeDto>))]
    public enum LinkRedirectModeDto { HostCallback, Capture }

    [JsonConverter(typeof(CamelCaseEnumConverter<LinkedAccountStatusDto>))]
    public enum LinkedAccountStatusDto { Ok, Syncing, Expired, Error }

    public sealed record LinkIconDto(string? Lucide, string? SvgUrl);

    public sealed record LinkCapabilityDto(string Kind, string Label, string? Icon, string? BasePath);

    public sealed record LinkFlowDto(string Id, string Label, string? Description);

    public sealed record LinkProviderDto(string Id, string DisplayName, string? Description, LinkIconDto Icon, List<LinkCapabilityDto> Capabilities, List<LinkFlowDto> Flows, int SortOrder);

    public sealed record LinkOptionDto(string Value, string Label, string? Detail, string? Icon, string? LinkProviderId);

    public sealed record LinkFieldDto(
        string Key,
        string Label,
        [property: JsonConverter(typeof(CamelCaseEnumConverter<LinkFieldTypeDto>))] LinkFieldTypeDto Type,
        string? Placeholder,
        string? Help,
        string? DefaultValue,
        bool Required,
        bool Secret,
        int? MaxLength,
        string? Pattern,
        List<LinkOptionDto> Options,
        bool AllowCustom);

    public sealed record LinkActionDto(string Id, string Label);

    public sealed record LinkOtpDto(int Length, string? Label, bool NumericOnly);

    public sealed record LinkPushCodeDto(string? Number, DateTimeOffset ExpiresAt, int PollIntervalSeconds);

    public sealed record LinkDeviceCodeDto(string UserCode, string VerificationUri, DateTimeOffset ExpiresAt, int PollIntervalSeconds);

    public sealed record LinkRedirectDto(string Url, [property: JsonConverter(typeof(CamelCaseEnumConverter<LinkRedirectModeDto>))] LinkRedirectModeDto Mode, string? CallbackPrefix, List<string> CaptureCookieDomains);

    public sealed record LinkDoneDto(string AccountId, string? Title);

    public sealed record LinkStepDto(
        string Id,
        [property: JsonConverter(typeof(CamelCaseEnumConverter<LinkStepKindDto>))] LinkStepKindDto Kind,
        string? Title,
        string? Description,
        string? Error,
        List<LinkFieldDto> Fields,
        LinkOtpDto? Otp,
        LinkPushCodeDto? PushCode,
        LinkDeviceCodeDto? DeviceCode,
        LinkRedirectDto? Redirect,
        List<LinkOptionDto> Options,
        List<LinkActionDto> Actions,
        string? SubmitLabel,
        LinkDoneDto? Done);

    public sealed record LinkSessionDto(string SessionId, string ProviderId, string FlowId, [property: JsonConverter(typeof(CamelCaseEnumConverter<LinkSessionStatus>))] LinkSessionStatus Status, DateTimeOffset ExpiresAt, LinkStepDto Step);

    /// <summary>Distinct from the legacy LinkedAccountDto of /api/me/linked-accounts so both keep a unique OpenAPI schema name.</summary>
    public sealed record LinkProviderAccountDto(
        string ProviderId,
        string ProviderName,
        string Id,
        string Title,
        string? Detail,
        [property: JsonConverter(typeof(CamelCaseEnumConverter<LinkedAccountStatusDto>))] LinkedAccountStatusDto Status,
        string? Message,
        DateTimeOffset? LinkedAt,
        DateTimeOffset? LastSyncedAt,
        List<LinkCapabilityDto> Capabilities,
        bool CanReauth,
        string? PictureUrl = null);

    public sealed class StartLinkRequest
    {
        public string? FlowId { get; init; }
        /// <summary>"web" or "mobile". When absent the web app (X-Schuly-Client: web) is web and everything else is mobile.</summary>
        public string? Platform { get; init; }
        public string? ReauthAccountId { get; init; }
    }

    public sealed class SubmitLinkRequest
    {
        public required string StepId { get; init; }
        public Dictionary<string, string>? Values { get; init; }
        public string? Action { get; init; }
    }

    public sealed record LinkErrorDto(string Message, List<string>? Errors);

    public static class LinkDtoMapper
    {
        public static LinkProviderDto ToDto(LinkProviderEntry entry, LinkPlatform? platform)
        {
            var d = entry.Descriptor;
            var flows = d.Flows.Where(f => platform is null || AllowedOn(f, platform.Value)).Select(f => new LinkFlowDto(f.Id, f.Label, f.Description)).ToList();
            var icon = new LinkIconDto(d.Icon.Lucide, entry.Svg is null ? null : $"/api/linking/providers/{d.Id}/icon.svg?v={entry.SvgVersion}");
            return new LinkProviderDto(d.Id, d.DisplayName, d.Description, icon, ToDtos(d.Capabilities), flows, d.SortOrder);
        }

        public static bool AllowedOn(LinkFlowDescriptor flow, LinkPlatform platform) =>
            flow.Platforms.HasFlag(platform == LinkPlatform.Web ? LinkPlatforms.Web : LinkPlatforms.Mobile);

        public static List<LinkCapabilityDto> ToDtos(IEnumerable<ProviderCapability> capabilities) =>
            capabilities.Select(c => new LinkCapabilityDto(c.Kind, c.Label, c.Icon, c.BasePath)).ToList();

        public static LinkStepDto ToDto(LinkStep s) => new(
            s.Id,
            Enum.Parse<LinkStepKindDto>(s.Kind.ToString()),
            s.Title,
            s.Description,
            s.Error,
            s.Fields.Select(ToDto).ToList(),
            s.Otp is null ? null : new LinkOtpDto(s.Otp.Length, s.Otp.Label, s.Otp.NumericOnly),
            s.PushCode is null ? null : new LinkPushCodeDto(s.PushCode.Number, s.PushCode.ExpiresAt, s.PushCode.PollIntervalSeconds),
            s.DeviceCode is null ? null : new LinkDeviceCodeDto(s.DeviceCode.UserCode, s.DeviceCode.VerificationUri, s.DeviceCode.ExpiresAt, s.DeviceCode.PollIntervalSeconds),
            s.Redirect is null ? null : new LinkRedirectDto(s.Redirect.Url, Enum.Parse<LinkRedirectModeDto>(s.Redirect.Mode.ToString()), s.Redirect.CallbackPrefix, s.Redirect.CaptureCookieDomains.ToList()),
            s.Options.Select(ToDto).ToList(),
            s.Actions.Select(a => new LinkActionDto(a.Id, a.Label)).ToList(),
            s.SubmitLabel,
            s.Done is null ? null : new LinkDoneDto(s.Done.AccountId, s.Done.Title));

        private static LinkFieldDto ToDto(LinkField f)
        {
            var secret = f.Secret || f.Type is LinkFieldType.Password or LinkFieldType.TotpSecret;
            return new LinkFieldDto(f.Key, f.Label, Enum.Parse<LinkFieldTypeDto>(f.Type.ToString()), f.Placeholder, f.Help, secret ? null : f.DefaultValue, f.Required, secret, f.MaxLength, f.Pattern, f.Options.Select(ToDto).ToList(), f.AllowCustom);
        }

        private static LinkOptionDto ToDto(LinkOption o) => new(o.Value, o.Label, o.Detail, o.Icon, o.LinkProviderId);
    }
}
