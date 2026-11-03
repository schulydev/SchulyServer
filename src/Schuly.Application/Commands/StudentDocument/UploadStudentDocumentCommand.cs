using Mediator;
using Microsoft.EntityFrameworkCore;
using Schuly.Application.Authorization;
using Schuly.Application.Models;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using Schuly.Infrastructure.Storage;

namespace Schuly.Application.Commands.StudentDocument
{
    [AllowAuthenticated]
    public record UploadStudentDocumentCommand(Guid SchoolUserId, Stream Content, string FileName, string? ContentType, string Title, string? Comment, string? Category, string? EnteredBy, string? FollowUpAction, DateOnly? FollowUpDate) : ICommand<Result<Guid>>;

    public class UploadStudentDocumentCommandHandler(SchulyDbContext db, IDocumentStorage storage, IUserService userService) : ICommandHandler<UploadStudentDocumentCommand, Result<Guid>>
    {
        public async ValueTask<Result<Guid>> Handle(UploadStudentDocumentCommand command, CancellationToken ct)
        {
            if (command.Title.Length > 300 || command.FileName.Length > 300 || command.Comment?.Length > 2000 || command.Category?.Length > 100 || command.EnteredBy?.Length > 200 || command.FollowUpAction?.Length > 500)
                return Result<Guid>.Failure("A document field is too long.");

            var currentUserId = await userService.GetCurrentUserIdAsync(ct);
            var owned = await db.SchoolUsers
                .AnyAsync(su => su.Id == command.SchoolUserId && su.ApplicationUserId == currentUserId, ct);
            if (!owned)
                return Result<Guid>.NotFound("SchoolUser not found");

            var blob = await storage.UploadAsync(command.Content, command.FileName, command.ContentType, ct);

            var doc = new Domain.StudentDocument
            {
                SchoolUserId = command.SchoolUserId,
                Title = command.Title,
                Comment = command.Comment,
                Category = command.Category,
                EnteredBy = command.EnteredBy,
                FileName = command.FileName,
                FileUrl = blob.Key,
                FileSizeBytes = blob.SizeBytes,
                FollowUpAction = command.FollowUpAction,
                FollowUpDate = command.FollowUpDate,
            };
            db.StudentDocuments.Add(doc);
            await db.SaveChangesAsync(ct);

            return Result<Guid>.Success(doc.Id);
        }
    }
}
