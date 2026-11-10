namespace Schuly.Domain
{
    /// <summary>An account the user linked with an outside identity provider; its secrets live in the vault.</summary>
    public class LinkedAccount : Base
    {
        public Guid ApplicationUserId { get; set; }
        public ApplicationUser? ApplicationUser { get; set; }

        public required string Provider { get; set; }
        public required string ExternalId { get; set; }
        public required string Email { get; set; }
        public string? DisplayName { get; set; }

        /// <summary>Storage key of the account's profile picture, set by the provider's plugin; only the owner sees it.</summary>
        public string? PictureKey { get; set; }
    }
}
