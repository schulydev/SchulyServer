using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Schuly.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAbsenceDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Comment",
                table: "Absences",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EndTime",
                table: "Absences",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ExcuseDeadline",
                table: "Absences",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Lessons",
                table: "Absences",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ParentStatus",
                table: "Absences",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ParentStatusDate",
                table: "Absences",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StartTime",
                table: "Absences",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TrainerComment",
                table: "Absences",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TrainerStatus",
                table: "Absences",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "TrainerStatusDate",
                table: "Absences",
                type: "date",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Comment",
                table: "Absences");

            migrationBuilder.DropColumn(
                name: "EndTime",
                table: "Absences");

            migrationBuilder.DropColumn(
                name: "ExcuseDeadline",
                table: "Absences");

            migrationBuilder.DropColumn(
                name: "Lessons",
                table: "Absences");

            migrationBuilder.DropColumn(
                name: "ParentStatus",
                table: "Absences");

            migrationBuilder.DropColumn(
                name: "ParentStatusDate",
                table: "Absences");

            migrationBuilder.DropColumn(
                name: "StartTime",
                table: "Absences");

            migrationBuilder.DropColumn(
                name: "TrainerComment",
                table: "Absences");

            migrationBuilder.DropColumn(
                name: "TrainerStatus",
                table: "Absences");

            migrationBuilder.DropColumn(
                name: "TrainerStatusDate",
                table: "Absences");
        }
    }
}
