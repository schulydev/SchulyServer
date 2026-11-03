using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Schuly.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPrivacyNoticeRecord : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "PolicyAcceptedAt",
                table: "ApplicationUsers",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PolicyVersionAccepted",
                table: "ApplicationUsers",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SwissSchoolConfirmedAt",
                table: "ApplicationUsers",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PolicyAcceptedAt",
                table: "ApplicationUsers");

            migrationBuilder.DropColumn(
                name: "PolicyVersionAccepted",
                table: "ApplicationUsers");

            migrationBuilder.DropColumn(
                name: "SwissSchoolConfirmedAt",
                table: "ApplicationUsers");
        }
    }
}
