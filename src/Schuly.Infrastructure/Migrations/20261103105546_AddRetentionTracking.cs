using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Schuly.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddRetentionTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The outbox becomes a queue without copies of grades and absence reasons: rows already handled go, and rows
            // still waiting lose the reason. Dropping Score below removes the grade values; pushes read them at send time.
            migrationBuilder.Sql("""DELETE FROM "NotificationOutbox" WHERE "Status" <> 0;""");
            migrationBuilder.Sql("""UPDATE "NotificationOutbox" SET "Summary" = NULL WHERE "Type" = 2;""");

            migrationBuilder.DropColumn(
                name: "Score",
                table: "NotificationOutbox");

            migrationBuilder.DropColumn(
                name: "SentAt",
                table: "NotificationOutbox");

            migrationBuilder.CreateTable(
                name: "InactivityWarnings",
                columns: table => new
                {
                    LoginId = table.Column<Guid>(type: "uuid", nullable: false),
                    SentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeleteAfter = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InactivityWarnings", x => x.LoginId);
                });

            migrationBuilder.CreateTable(
                name: "PendingPurges",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    Target = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    PluginSource = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PendingPurges", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "InactivityWarnings");

            migrationBuilder.DropTable(
                name: "PendingPurges");

            migrationBuilder.AddColumn<decimal>(
                name: "Score",
                table: "NotificationOutbox",
                type: "numeric(4,2)",
                precision: 4,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SentAt",
                table: "NotificationOutbox",
                type: "timestamp with time zone",
                nullable: true);
        }
    }
}
