using Mediator;
using Schuly.Application.Authorization;
using Schuly.Application.Dtos;
using Schuly.Application.Models;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure.Helply;
using Schuly.Infrastructure.Services;

namespace Schuly.Application.Commands.Helply
{
    [AllowAuthenticated]
    public record CreateHelplyConversationCommand(string? Title) : ICommand<Result<HelplyConversationSummaryDto>>;

    public class CreateHelplyConversationCommandHandler(HelplyConversationStore store, IUserService userService) : ICommandHandler<CreateHelplyConversationCommand, Result<HelplyConversationSummaryDto>>
    {
        public async ValueTask<Result<HelplyConversationSummaryDto>> Handle(CreateHelplyConversationCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var conversation = await store.CreateAsync(userId, command.Title, cancellationToken);
            return Result.Success(HelplyDtoMapper.ToSummary(conversation, store.ReadTitle(conversation)));
        }
    }

    [AllowAuthenticated]
    public record RenameHelplyConversationCommand(Guid Id, string Title) : ICommand<Result<HelplyConversationSummaryDto>>;

    public class RenameHelplyConversationCommandHandler(HelplyConversationStore store, IUserService userService) : ICommandHandler<RenameHelplyConversationCommand, Result<HelplyConversationSummaryDto>>
    {
        public async ValueTask<Result<HelplyConversationSummaryDto>> Handle(RenameHelplyConversationCommand command, CancellationToken cancellationToken)
        {
            var title = command.Title?.Trim() ?? string.Empty;
            if (title.Length is 0 or > HelplyConversationStore.MaxTitleLength)
                return Result.Failure<HelplyConversationSummaryDto>($"The title must be 1 to {HelplyConversationStore.MaxTitleLength} characters.");

            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var conversation = await store.FindAsync(userId, command.Id, cancellationToken);
            if (conversation is null)
                return Result.NotFound<HelplyConversationSummaryDto>("Conversation not found");

            store.WriteTitle(conversation, title);
            conversation.UpdatedAt = DateTime.UtcNow;
            await store.SaveAsync(cancellationToken);
            return Result.Success(HelplyDtoMapper.ToSummary(conversation, title));
        }
    }

    [AllowAuthenticated]
    public record DeleteHelplyConversationCommand(Guid Id) : ICommand<Result>;

    public class DeleteHelplyConversationCommandHandler(HelplyConversationStore store, IHelplySandboxClient sandbox, IUserService userService) : ICommandHandler<DeleteHelplyConversationCommand, Result>
    {
        public async ValueTask<Result> Handle(DeleteHelplyConversationCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            if (!await store.DeleteAsync(userId, command.Id, cancellationToken))
                return Result.NotFound("Conversation not found");
            await HelplyWorkspaceCleanup.DeleteAsync(sandbox, [command.Id]);
            return Result.Success();
        }
    }

    /// <summary>Wipes the workspaces of deleted conversations. Best effort and bounded: the sidecar's own sweep removes anything left behind within minutes.</summary>
    public static class HelplyWorkspaceCleanup
    {
        public static async Task DeleteAsync(IHelplySandboxClient sandbox, IEnumerable<Guid> conversationIds)
        {
            if (!sandbox.IsConfigured)
                return;
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            foreach (var id in conversationIds)
            {
                try
                {
                    await sandbox.DeleteAsync(id, timeout.Token);
                }
                catch (Exception)
                {
                    return;
                }
            }
        }
    }

    [AllowAuthenticated]
    public record DeleteAllHelplyConversationsCommand() : ICommand<Result>;

    public class DeleteAllHelplyConversationsCommandHandler(HelplyConversationStore store, IHelplySandboxClient sandbox, IUserService userService) : ICommandHandler<DeleteAllHelplyConversationsCommand, Result>
    {
        public async ValueTask<Result> Handle(DeleteAllHelplyConversationsCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var ids = (await store.ListAsync(userId, cancellationToken)).Select(c => c.Id).ToList();
            await store.DeleteAllAsync(userId, cancellationToken);
            await HelplyWorkspaceCleanup.DeleteAsync(sandbox, ids);
            return Result.Success();
        }
    }

    /// <summary>Changes what Helply may do. It is normalised like any MCP permission set and applies to the next message.</summary>
    [AllowAuthenticated]
    public record UpdateHelplySettingsCommand(McpPermissionSet Permissions) : ICommand<Result<HelplySettingsDto>>;

    public class UpdateHelplySettingsCommandHandler(HelplyConversationStore store, IHelplySandboxClient sandbox, IUserService userService) : ICommandHandler<UpdateHelplySettingsCommand, Result<HelplySettingsDto>>
    {
        public async ValueTask<Result<HelplySettingsDto>> Handle(UpdateHelplySettingsCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var permissions = await store.SetPermissionsAsync(userId, command.Permissions, cancellationToken);
            return Result.Success(HelplyDtoMapper.ToDto(permissions, await store.GetWorkspaceEnabledAsync(userId, cancellationToken), sandbox.IsConfigured));
        }
    }

    /// <summary>Turns Helply's workspace (running code in a sandbox without network) on or off for the caller. Off by default; applies to the next message.</summary>
    [AllowAuthenticated]
    public record UpdateHelplyWorkspaceCommand(bool Enabled) : ICommand<Result<HelplySettingsDto>>;

    public class UpdateHelplyWorkspaceCommandHandler(HelplyConversationStore store, IHelplySandboxClient sandbox, IUserService userService) : ICommandHandler<UpdateHelplyWorkspaceCommand, Result<HelplySettingsDto>>
    {
        public async ValueTask<Result<HelplySettingsDto>> Handle(UpdateHelplyWorkspaceCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var enabled = await store.SetWorkspaceEnabledAsync(userId, command.Enabled, cancellationToken);
            return Result.Success(HelplyDtoMapper.ToDto(await store.GetPermissionsAsync(userId, cancellationToken), enabled, sandbox.IsConfigured));
        }
    }

    /// <summary>
    /// Stores a file the caller attaches to one of their conversations. The type comes from the bytes, never from the client; the name and contents are encrypted. The file waits
    /// unsent until a message carries it, and is removed after a day otherwise.
    /// </summary>
    [AllowAuthenticated]
    public record UploadHelplyAttachmentCommand(Guid ConversationId, string? FileName, string? ContentType, byte[] Data) : ICommand<Result<HelplyAttachmentDto>>;

    public class UploadHelplyAttachmentCommandHandler(HelplyConversationStore store, IUserService userService) : ICommandHandler<UploadHelplyAttachmentCommand, Result<HelplyAttachmentDto>>
    {
        public async ValueTask<Result<HelplyAttachmentDto>> Handle(UploadHelplyAttachmentCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var result = await store.Attachments.UploadAsync(userId, command.ConversationId, command.FileName, command.ContentType, command.Data, cancellationToken);
            if (result.Attachment is { } attachment)
                return Result.Success(HelplyDtoMapper.ToDto(attachment));
            return result.Status == 404 ? Result.NotFound<HelplyAttachmentDto>(result.Error ?? "Conversation not found") : Result.Failure<HelplyAttachmentDto>(result.Error ?? "The file could not be attached.");
        }
    }

    /// <summary>Removes a file the caller attached but has not sent yet.</summary>
    [AllowAuthenticated]
    public record DeleteHelplyAttachmentCommand(Guid ConversationId, Guid AttachmentId) : ICommand<Result>;

    public class DeleteHelplyAttachmentCommandHandler(HelplyConversationStore store, IUserService userService) : ICommandHandler<DeleteHelplyAttachmentCommand, Result>
    {
        public async ValueTask<Result> Handle(DeleteHelplyAttachmentCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            return await store.Attachments.DeletePendingAsync(userId, command.ConversationId, command.AttachmentId, cancellationToken) ? Result.Success() : Result.NotFound("File not found");
        }
    }
}
