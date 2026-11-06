namespace Schuly.Application.Dtos
{
    public class ApplicationUserDto
    {
        public Guid Id { get; set; }
        public required string ExternalId { get; set; }
        public required string Email { get; set; }
        public string? DisplayName { get; set; }
        public string? ProfilePictureUrl { get; set; }
        /// <summary>False for an account signed in only through single sign-on, which can set a first password after a fresh sign-in.</summary>
        public bool HasPassword { get; set; }
        /// <summary>True when <see cref="Email"/> is the sign-in address and somebody proved it.</summary>
        public bool EmailConfirmed { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        public List<SchoolUserSummaryDto> SchoolUsers { get; set; } = new List<SchoolUserSummaryDto>();
    }

    public class SchoolUserSummaryDto
    {
        public Guid Id { get; set; }
        public string? FirstName { get; set; }
        public string? LastName { get; set; }
        public string? Email { get; set; }
        public string? Role { get; set; }
    }
}
