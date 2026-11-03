namespace Schuly.Domain
{
    public class ApplicationUser : Base
    {
        public required string ExternalId { get; set; }
        public required string Email { get; set; }
        public string DisplayName { get; set; } = "Schuly User";
        public string? ProfilePictureUrl { get; set; }
        public DateTime? LastSeenAt { get; set; }

        /// <summary>The privacy policy version the user last confirmed having seen, and when.</summary>
        public string? PolicyVersionAccepted { get; set; }
        public DateTime? PolicyAcceptedAt { get; set; }

        /// <summary>When the user last confirmed "I attend a school in Switzerland". Only asked on a server with <c>SignUp:SwitzerlandOnly</c>.</summary>
        public DateTime? SwissSchoolConfirmedAt { get; set; }
        public ICollection<SchoolUser> SchoolUsers { get; set; } = [];
        public ICollection<Teacher> Teachers { get; set; } = [];
    }
}
