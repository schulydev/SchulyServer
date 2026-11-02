using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Schuly.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddHelplyAttachments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "WorkspaceEnabled",
                table: "HelplySettings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "HelplyAttachments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ApplicationUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    MessageId = table.Column<Guid>(type: "uuid", nullable: true),
                    FromAssistant = table.Column<bool>(type: "boolean", nullable: false),
                    FileName = table.Column<byte[]>(type: "bytea", nullable: false),
                    MediaType = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    PageCount = table.Column<int>(type: "integer", nullable: true),
                    HasText = table.Column<bool>(type: "boolean", nullable: false),
                    TextLength = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HelplyAttachments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HelplyAttachments_ApplicationUsers_ApplicationUserId",
                        column: x => x.ApplicationUserId,
                        principalTable: "ApplicationUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_HelplyAttachments_HelplyConversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "HelplyConversations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "HelplyAttachmentContents",
                columns: table => new
                {
                    AttachmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Data = table.Column<byte[]>(type: "bytea", nullable: false),
                    Text = table.Column<byte[]>(type: "bytea", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HelplyAttachmentContents", x => x.AttachmentId);
                    table.ForeignKey(
                        name: "FK_HelplyAttachmentContents_HelplyAttachments_AttachmentId",
                        column: x => x.AttachmentId,
                        principalTable: "HelplyAttachments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HelplyAttachments_ApplicationUserId",
                table: "HelplyAttachments",
                column: "ApplicationUserId");

            migrationBuilder.CreateIndex(
                name: "IX_HelplyAttachments_ConversationId_MessageId",
                table: "HelplyAttachments",
                columns: new[] { "ConversationId", "MessageId" });

            migrationBuilder.CreateIndex(
                name: "IX_HelplyAttachments_MessageId_CreatedAt",
                table: "HelplyAttachments",
                columns: new[] { "MessageId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "HelplyAttachmentContents");

            migrationBuilder.DropTable(
                name: "HelplyAttachments");

            migrationBuilder.DropColumn(
                name: "WorkspaceEnabled",
                table: "HelplySettings");
        }
    }
}
