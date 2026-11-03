using Schuly.Application.Dtos;
using Schuly.Domain;

namespace Schuly.Application.Mappers
{
    public static class SchoolUserMapper
    {
        public static SchoolUserDto ToDto(this SchoolUser schoolUser)
        {
            return new SchoolUserDto
            {
                Id = schoolUser.Id,
                ApplicationUserId = schoolUser.ApplicationUserId,
                SchoolId = schoolUser.SchoolId,
                SchoolName = schoolUser.School?.Name,
                FirstName = schoolUser.FirstName,
                LastName = schoolUser.LastName,
                Email = schoolUser.Email,
                ProfilePictureUrl = schoolUser.ProfilePictureUrl,
                EntryDate = schoolUser.EntryDate,
                LeaveDate = schoolUser.LeaveDate,
                Role = schoolUser.Role,
                State = schoolUser.State,
                CreatedAt = schoolUser.CreatedAt,
                UpdatedAt = schoolUser.UpdatedAt,
                Absences = schoolUser.Absences.Select(a => a.ToDto()).ToList(),
                Grades = schoolUser.Grades.Select(g => g.ToDto()).ToList(),
                Classes = schoolUser.Classes.Select(c => new UserClassDto
                {
                    ClassId = c.Id,
                    ClassName = c.Name
                }).ToList()
            };
        }

        public static List<SchoolUserDto> ToDto(this List<SchoolUser> schoolUsers)
        {
            return schoolUsers.Select(su => su.ToDto()).ToList();
        }

        public static SchoolUserDto ToSummaryDto(this SchoolUser schoolUser)
        {
            return new SchoolUserDto
            {
                Id = schoolUser.Id,
                SchoolId = schoolUser.SchoolId,
                SchoolName = schoolUser.School?.Name,
                FirstName = schoolUser.FirstName,
                LastName = schoolUser.LastName,
                Email = schoolUser.Email,
                ProfilePictureUrl = schoolUser.ProfilePictureUrl,
                Role = schoolUser.Role,
                State = schoolUser.State,
                CreatedAt = schoolUser.CreatedAt,
                UpdatedAt = schoolUser.UpdatedAt,
                Classes = schoolUser.Classes.Select(c => new UserClassDto
                {
                    ClassId = c.Id,
                    ClassName = c.Name
                }).ToList()
            };
        }

        public static ClassMemberDto ToClassMemberDto(this SchoolUser schoolUser)
        {
            return new ClassMemberDto
            {
                Id = schoolUser.Id,
                SchoolId = schoolUser.SchoolId,
                FirstName = schoolUser.FirstName,
                LastName = schoolUser.LastName,
                ProfilePictureUrl = schoolUser.ProfilePictureUrl,
                Role = schoolUser.Role,
                Absences = schoolUser.Absences.Select(a => a.ToDto()).ToList(),
                Grades = schoolUser.Grades.Select(g => g.ToDto()).ToList()
            };
        }
    }
}
