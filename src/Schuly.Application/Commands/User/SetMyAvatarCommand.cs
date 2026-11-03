using Mediator;
using Schuly.Application.Authorization;
using Schuly.Application.Models;
using Schuly.Infrastructure;
using Schuly.Infrastructure.Services;
using Schuly.Infrastructure.Storage;

namespace Schuly.Application.Commands.User
{
    [AllowAuthenticated]
    public record SetMyAvatarCommand(Stream Content, string? ContentType, long Length) : ICommand<Result>;

    public class SetMyAvatarCommandHandler(SchulyDbContext dbContext, IUserService userService, IDocumentStorage storage) : ICommandHandler<SetMyAvatarCommand, Result>
    {
        public const long MaxBytes = 2_000_000;

        private static readonly Dictionary<string, string> Extensions = new(StringComparer.OrdinalIgnoreCase)
        {
            ["image/png"] = "png",
            ["image/jpeg"] = "jpg",
            ["image/webp"] = "webp",
        };

        public async ValueTask<Result> Handle(SetMyAvatarCommand command, CancellationToken cancellationToken)
        {
            if (command.Length is <= 0 or > MaxBytes)
                return Result.Failure("The picture must be at most 2 MB.");

            if (command.ContentType is null || !Extensions.TryGetValue(command.ContentType, out var extension))
                return Result.Failure("Use a PNG, JPEG or WebP picture.");

            var userId = await userService.GetCurrentUserIdAsync(cancellationToken);
            var user = await dbContext.ApplicationUsers.FindAsync([userId], cancellationToken);
            if (user is null)
                return Result.Failure("User not found");

            var blob = await storage.UploadAsync(command.Content, $"avatar.{extension}", command.ContentType, cancellationToken);
            var previous = user.ProfilePictureUrl;

            user.ProfilePictureUrl = blob.Key;
            await dbContext.SaveChangesAsync(cancellationToken);

            if (IsStoredKey(previous))
                await storage.DeleteAsync(previous!, cancellationToken);

            return Result.Success();
        }

        public static bool IsStoredKey(string? value) => BlobKeys.IsStored(value);
    }
}
