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

    public class GetHelplySettingsQueryHandler(HelplyConversationStore store, IUserService userService) : IQueryHandler<GetHelplySettingsQuery, Result<HelplySettingsDto>>
    {
        public async ValueTask<Result<HelplySettingsDto>> Handle(GetHelplySettingsQuery query, CancellationToken cancellationToken)
        {
            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            return Result.Success(HelplyDtoMapper.ToDto(await store.GetPermissionsAsync(userId, cancellationToken)));
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
