using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Schuly.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class DropSchoolUserProfileFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Birthday",
                table: "SchoolUsers");

            migrationBuilder.DropColumn(
                name: "City",
                table: "SchoolUsers");

            migrationBuilder.DropColumn(
                name: "PhoneNumber",
                table: "SchoolUsers");

            migrationBuilder.DropColumn(
                name: "PrivateEmail",
                table: "SchoolUsers");

            migrationBuilder.DropColumn(
                name: "Street",
                table: "SchoolUsers");

            migrationBuilder.DropColumn(
                name: "Zip",
                table: "SchoolUsers");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "Birthday",
                table: "SchoolUsers",
                type: "date",
                nullable: false,
                defaultValue: new DateOnly(1, 1, 1));

            migrationBuilder.AddColumn<string>(
                name: "City",
                table: "SchoolUsers",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PhoneNumber",
                table: "SchoolUsers",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PrivateEmail",
                table: "SchoolUsers",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Street",
                table: "SchoolUsers",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Zip",
                table: "SchoolUsers",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);
        }
    }
}
