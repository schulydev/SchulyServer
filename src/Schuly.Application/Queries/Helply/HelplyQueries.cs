using Mediator;
using Schuly.Application.Authorization;
using Schuly.Application.Dtos;
using Schuly.Application.Models;
using Schuly.Infrastructure.Helply;
using Schuly.Infrastructure.Services;

namespace Schuly.Application.Queries.Helply
{
    [AllowAuthenticated]
    public record GetHelplySettingsQuery() : IQuery<Result<HelplySettingsDto>>;

    public class GetHelplySettingsQueryHandler(HelplyConversationStore store, IHelplySandboxClient sandbox, IUserService userService) : IQueryHandler<GetHelplySettingsQuery, Result<HelplySettingsDto>>
    {
        public async ValueTask<Result<HelplySettingsDto>> Handle(GetHelplySettingsQuery query, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            return Result.Success(HelplyDtoMapper.ToDto(await store.GetPermissionsAsync(userId, cancellationToken), await store.GetWorkspaceEnabledAsync(userId, cancellationToken), sandbox.IsConfigured, await store.GetReasoningEffortAsync(userId, cancellationToken)));
        }
    }

    /// <summary>One file of one of the caller's conversations, for download. Anyone else's id, or a file of an expired conversation, is not found.</summary>
    [AllowAuthenticated]
    public record GetHelplyAttachmentQuery(Guid ConversationId, Guid AttachmentId) : IQuery<Result<HelplyAttachmentFile>>;

    public class GetHelplyAttachmentQueryHandler(HelplyConversationStore store, IUserService userService) : IQueryHandler<GetHelplyAttachmentQuery, Result<HelplyAttachmentFile>>
    {
        public async ValueTask<Result<HelplyAttachmentFile>> Handle(GetHelplyAttachmentQuery query, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var file = await store.Attachments.GetFileAsync(userId, query.ConversationId, query.AttachmentId, cancellationToken);
            return file is null ? Result.NotFound<HelplyAttachmentFile>("File not found") : Result.Success(file);
        }
    }

    [AllowAuthenticated]
    public record ListHelplyConversationsQuery() : IQuery<Result<List<HelplyConversationSummaryDto>>>;

    public class ListHelplyConversationsQueryHandler(HelplyConversationStore store, IUserService userService) : IQueryHandler<ListHelplyConversationsQuery, Result<List<HelplyConversationSummaryDto>>>
    {
        public async ValueTask<Result<List<HelplyConversationSummaryDto>>> Handle(ListHelplyConversationsQuery query, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var conversations = await store.ListAsync(userId, cancellationToken);
            return Result.Success(conversations.Select(c => HelplyDtoMapper.ToSummary(c, store.ReadTitle(c))).ToList());
        }
    }

    [AllowAuthenticated]
    public record GetHelplyConversationQuery(Guid Id) : IQuery<Result<HelplyConversationDto>>;

    public class GetHelplyConversationQueryHandler(HelplyConversationStore store, IUserService userService) : IQueryHandler<GetHelplyConversationQuery, Result<HelplyConversationDto>>
    {
        public async ValueTask<Result<HelplyConversationDto>> Handle(GetHelplyConversationQuery query, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var conversation = await store.FindAsync(userId, query.Id, cancellationToken);
            if (conversation is null)
                return Result.NotFound<HelplyConversationDto>("Conversation not found");
            return Result.Success(HelplyDtoMapper.ToDto(conversation, store.ReadTitle(conversation), store.ReadTranscript(conversation)));
        }
    }
}
