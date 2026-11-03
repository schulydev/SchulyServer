namespace Schuly.Domain
{
    public class Teacher : Base
    {
        public Guid SchoolId { get; set; }
        public School? School { get; set; }

        public Guid? ApplicationUserId { get; set; }
        public ApplicationUser? ApplicationUser { get; set; }

        public required string FirstName { get; set; }
        public required string LastName { get; set; }
        public required string Code { get; set; }

        public ICollection<Class> Classes { get; set; } = [];
    }
}
