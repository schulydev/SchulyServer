namespace Schuly.Application.Dtos
{
    public class LinkedAccountDto
    {
        public Guid Id { get; set; }
        public required string Provider { get; set; }
        public required string Email { get; set; }
        public string? DisplayName { get; set; }
        /// <summary>Short-lived signed URL of the account's profile picture, or null when it has none.</summary>
        public string? PictureUrl { get; set; }
        public DateTime CreatedAt { get; set; }
    }
}
