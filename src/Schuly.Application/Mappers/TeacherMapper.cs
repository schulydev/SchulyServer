using Schuly.Application.Dtos;
using Schuly.Domain;

namespace Schuly.Application.Mappers
{
    public static class TeacherMapper
    {
        public static TeacherDto ToDto(this Teacher teacher)
        {
            return new TeacherDto
            {
                Id = teacher.Id,
                SchoolId = teacher.SchoolId,
                SchoolName = teacher.School?.Name,
                FirstName = teacher.FirstName,
                LastName = teacher.LastName,
                Code = teacher.Code
            };
        }

        public static List<TeacherDto> ToDto(this List<Teacher> teachers)
        {
            return teachers.Select(t => t.ToDto()).ToList();
        }
    }
}
