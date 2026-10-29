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

    public class DeleteHelplyConversationCommandHandler(HelplyConversationStore store, IUserService userService) : ICommandHandler<DeleteHelplyConversationCommand, Result>
    {
        public async ValueTask<Result> Handle(DeleteHelplyConversationCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            return await store.DeleteAsync(userId, command.Id, cancellationToken) ? Result.Success() : Result.NotFound("Conversation not found");
        }
    }

    [AllowAuthenticated]
    public record DeleteAllHelplyConversationsCommand() : ICommand<Result>;

    public class DeleteAllHelplyConversationsCommandHandler(HelplyConversationStore store, IUserService userService) : ICommandHandler<DeleteAllHelplyConversationsCommand, Result>
    {
        public async ValueTask<Result> Handle(DeleteAllHelplyConversationsCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            await store.DeleteAllAsync(userId, cancellationToken);
            return Result.Success();
        }
    }

    /// <summary>Changes what Helply may do. It is normalised like any MCP permission set and applies to the next message.</summary>
    [AllowAuthenticated]
    public record UpdateHelplySettingsCommand(McpPermissionSet Permissions) : ICommand<Result<HelplySettingsDto>>;

    public class UpdateHelplySettingsCommandHandler(HelplyConversationStore store, IUserService userService) : ICommandHandler<UpdateHelplySettingsCommand, Result<HelplySettingsDto>>
    {
        public async ValueTask<Result<HelplySettingsDto>> Handle(UpdateHelplySettingsCommand command, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            return Result.Success(HelplyDtoMapper.ToDto(await store.SetPermissionsAsync(userId, command.Permissions, cancellationToken)));
        }
    }
}
