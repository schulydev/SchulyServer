using Schuly.Application.Queries.User;
using Schuly.Domain.Helply;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure.Helply;
using Schuly.Infrastructure.Vault;
using Toamaisutaa.Abstractions;
using Schuly.Domain;
using Schuly.Domain.Enums;
using Schuly.Tests.TestHelpers;

namespace Schuly.Tests
{
    public class AccountExportTests
    {
        private sealed record SeedResult(Guid User1Id, Guid User2Id, Guid SchoolUser1Id, Guid SchoolUser2Id);

        private static SeedResult Seed(string db)
        {
            var schoolId = Guid.NewGuid();
            var school = new School { Id = schoolId, Name = "Test School" };

            var user1 = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = "ext-1", Email = "u1@example.com" };
            var user2 = new ApplicationUser { Id = Guid.NewGuid(), ExternalId = "ext-2", Email = "u2@example.com" };

            var su1 = TestDb.NewSchoolUser(schoolId, "One");
            su1.ApplicationUserId = user1.Id;
            var su2 = TestDb.NewSchoolUser(schoolId, "Two");
            su2.ApplicationUserId = user2.Id;

            var exam = new Exam { Name = "E1", Type = default, Class = new Class { Name = "C", SchoolId = schoolId, Students = { su1, su2 } } };
            exam.Grades.Add(new Grade { Score = 5, Weighting = 1, SchoolUserId = su1.Id });
            exam.Grades.Add(new Grade { Score = 4, Weighting = 1, SchoolUserId = su2.Id });

            su1.Absences.Add(new Absence { Reason = "a", Type = AbsenceType.Absence, From = DateTime.UtcNow, Until = DateTime.UtcNow, SchoolUserId = su1.Id });
            su2.Absences.Add(new Absence { Reason = "b", Type = AbsenceType.Absence, From = DateTime.UtcNow, Until = DateTime.UtcNow, SchoolUserId = su2.Id });

            var agenda1 = new AgendaEntry { EntryType = AgendaEntryType.Event, Title = "A1", Date = DateTime.UtcNow, SchoolUserId = su1.Id };
            var agenda2 = new AgendaEntry { EntryType = AgendaEntryType.Event, Title = "A2", Date = DateTime.UtcNow, SchoolUserId = su2.Id };

            var report1 = new SemesterReport { SchoolUserId = su1.Id, ProgramCode = "P", ClassName = "C", SchoolYearStart = 2024, SemesterHalf = 1 };
            report1.Subjects.Add(new SemesterSubjectGrade { SubjectCode = "MATH", SubjectName = "Math" });
            var report2 = new SemesterReport { SchoolUserId = su2.Id, ProgramCode = "P", ClassName = "C", SchoolYearStart = 2024, SemesterHalf = 1 };
            report2.Subjects.Add(new SemesterSubjectGrade { SubjectCode = "MATH", SubjectName = "Math" });

            var doc1 = new StudentDocument { SchoolUserId = su1.Id, Title = "Doc1", FileUrl = "key-1" };
            var doc2 = new StudentDocument { SchoolUserId = su2.Id, Title = "Doc2", FileUrl = "key-2" };

            using var ctx = TestDb.NewContext(db);
            ctx.Schools.Add(school);
            ctx.ApplicationUsers.AddRange(user1, user2);
            ctx.Exams.Add(exam);
            ctx.AgendaEntries.AddRange(agenda1, agenda2);
            ctx.SemesterReports.AddRange(report1, report2);
            ctx.StudentDocuments.AddRange(doc1, doc2);
            ctx.SaveChanges();

            return new SeedResult(user1.Id, user2.Id, su1.Id, su2.Id);
        }

        private static readonly HelplyCipher Cipher = new(VaultKeyring.Ephemeral());

        [Test]
        public async Task The_export_covers_everything_stored_about_the_user_and_nothing_of_another()
        {
            var db = nameof(The_export_covers_everything_stored_about_the_user_and_nothing_of_another);
            var loginId = Guid.CreateVersion7();
            var userId = Guid.NewGuid();
            var otherId = Guid.NewGuid();
            var conversationId = Guid.NewGuid();
            var attachmentId = Guid.NewGuid();
            using (var ctx = TestDb.NewContext(db))
            {
                ctx.ApplicationUsers.Add(new ApplicationUser { Id = userId, ExternalId = loginId.ToString(), Email = "me@example.com", PolicyVersionAccepted = "v1", SwissSchoolConfirmedAt = DateTime.UtcNow });
                ctx.Set<ToamaisutaaUser>().Add(new ToamaisutaaUser { Id = loginId, SecurityStamp = "secret-stamp" });
                ctx.Set<ToamaisutaaPasswordCredential>().Add(new ToamaisutaaPasswordCredential { UserId = loginId, UserName = "mia", NormalizedUserName = "MIA", Email = "me@example.com", NormalizedEmail = "ME@EXAMPLE.COM", PasswordHash = "secret-hash" });
                ctx.Set<ToamaisutaaRefreshToken>().Add(new ToamaisutaaRefreshToken { Id = Guid.NewGuid(), UserId = loginId, FamilyId = Guid.NewGuid(), TokenHash = "secret-token-hash", SecurityStamp = "s", IpAddress = "203.0.113.9", UserAgent = "Browser" });

                ctx.SecurityAuditEntries.Add(new SecurityAuditEntry { Id = Guid.NewGuid(), Kind = "sign-in-failed", UserId = loginId, OccurredAt = DateTime.UtcNow });
                ctx.HelplySettings.Add(new HelplySettings { ApplicationUserId = userId, WorkspaceEnabled = true });
                ctx.HelplyConversations.Add(new HelplyConversation
                {
                    Id = conversationId,
                    ApplicationUserId = userId,
                    Title = Cipher.Encrypt("My chat", conversationId, userId, HelplyCipher.TitleField),
                    Transcript = Cipher.Encrypt("[{\"text\":\"hello helply\"}]", conversationId, userId, HelplyCipher.TranscriptField),
                });
                ctx.HelplyAttachments.Add(new HelplyAttachment { Id = attachmentId, ApplicationUserId = userId, ConversationId = conversationId, FileName = Cipher.Encrypt("note.pdf", conversationId, userId, HelplyAttachmentStore.Field(attachmentId, "name")), MediaType = "application/pdf", SizeBytes = 12 });

                var client = new McpOAuthClient { ClientId = "c", ClientName = "Some AI", RedirectUris = ["https://a.example/cb"] };
                ctx.McpGrants.Add(new McpGrant { ApplicationUserId = userId, McpOAuthClient = client });
                ctx.McpApiKeys.Add(new McpApiKey { ApplicationUserId = userId, Name = "laptop", Prefix = "schuly_mcp_abc", KeyHash = "secret-key-hash" });
                ctx.McpActivities.Add(new McpActivity { ApplicationUserId = userId, ToolName = "list_grades", Allowed = true });

                ctx.NotificationPreferences.Add(new NotificationPreference { ApplicationUserId = userId, IncludeDetails = true });
                ctx.DeviceTokens.Add(new DeviceToken { ApplicationUserId = userId, Token = "device-1", Platform = "android", Locale = "de" });
                ctx.DeviceTokens.Add(new DeviceToken { ApplicationUserId = otherId, Token = "device-of-another", Platform = "android", Locale = "de" });
                await ctx.SaveChangesAsync();
            }

            using var read = TestDb.NewContext(db);
            var result = await new ExportCurrentUserQueryHandler(read, new FakeUserService { CurrentUserId = userId }, Cipher).Handle(new ExportCurrentUserQuery(), CancellationToken.None);
            var json = System.Text.Json.JsonSerializer.Serialize(result.Value);

            foreach (var expected in new[] { "mia", "203.0.113.9", "My chat", "hello helply", "note.pdf", "Some AI", "laptop", "list_grades", "device-1", "v1", "sign-in-failed", "privacy@schuly.dev" })
                await Assert.That(json).Contains(expected);
            foreach (var secret in new[] { "secret-stamp", "secret-hash", "secret-token-hash", "secret-key-hash", "device-of-another" })
                await Assert.That(json).DoesNotContain(secret);
            await Assert.That(result.Value!.Helply!.WorkspaceEnabled).IsTrue();
            await Assert.That(result.Value!.Helply!.ReasoningEffort).IsEqualTo(HelplyReasoningEffort.High);
            await Assert.That(result.Value!.Notifications!.Preferences!.IncludeDetails).IsTrue();
            await Assert.That(result.Value!.PrivacyNotice!.SwissSchoolConfirmedAt).IsNotNull();
        }

        [Test]
        public async Task Export_contains_only_the_callers_own_data()
        {
            var db = nameof(Export_contains_only_the_callers_own_data);
            var seed = Seed(db);

            using var ctx = TestDb.NewContext(db);
            var handler = new ExportCurrentUserQueryHandler(ctx, new FakeUserService() { CurrentUserId = seed.User1Id }, Cipher);

            var result = await handler.Handle(new ExportCurrentUserQuery(), CancellationToken.None);

            await Assert.That(result.IsSuccess).IsTrue();
            var export = result.Value!;

            await Assert.That(export.Profile.Id).IsEqualTo(seed.User1Id);

            await Assert.That(export.SchoolUsers.Count).IsEqualTo(1);
            await Assert.That(export.SchoolUsers.Single().Id).IsEqualTo(seed.SchoolUser1Id);
            await Assert.That(export.SchoolUsers.Single().Grades.Count).IsEqualTo(1);
            await Assert.That(export.SchoolUsers.Single().Absences.Count).IsEqualTo(1);

            await Assert.That(export.AgendaEntries.Count).IsEqualTo(1);
            await Assert.That(export.AgendaEntries.Single().SchoolUserId).IsEqualTo(seed.SchoolUser1Id);

            await Assert.That(export.SemesterReports.Count).IsEqualTo(1);
            await Assert.That(export.SemesterReports.Single().SchoolUserId).IsEqualTo(seed.SchoolUser1Id);
            await Assert.That(export.SemesterReports.Single().Subjects.Count).IsEqualTo(1);

            await Assert.That(export.Documents.Count).IsEqualTo(1);
            await Assert.That(export.Documents.Single().SchoolUserId).IsEqualTo(seed.SchoolUser1Id);

            await Assert.That(export.SchoolUsers.Any(su => su.Id == seed.SchoolUser2Id)).IsFalse();
            await Assert.That(export.AgendaEntries.Any(ae => ae.SchoolUserId == seed.SchoolUser2Id)).IsFalse();
            await Assert.That(export.SemesterReports.Any(r => r.SchoolUserId == seed.SchoolUser2Id)).IsFalse();
            await Assert.That(export.Documents.Any(d => d.SchoolUserId == seed.SchoolUser2Id)).IsFalse();
        }

        [Test]
        public async Task Export_fails_when_the_current_user_does_not_exist()
        {
            using var ctx = TestDb.NewContext(nameof(Export_fails_when_the_current_user_does_not_exist));
            var handler = new ExportCurrentUserQueryHandler(ctx, new FakeUserService() { CurrentUserId = Guid.NewGuid() }, Cipher);

            var result = await handler.Handle(new ExportCurrentUserQuery(), CancellationToken.None);

            await Assert.That(result.IsSuccess).IsFalse();
        }
    }
}
