using Toamaisutaa.EntityFrameworkCore;
using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Schuly.Domain;
using Schuly.Domain.Helply;
using Schuly.Domain.Mcp;
using Schuly.Infrastructure.Mcp;

namespace Schuly.Infrastructure
{
    public class SchulyDbContext : DbContext
    {
        public DbSet<Class> Classes { get; set; }
        public DbSet<ApplicationUser> ApplicationUsers { get; set; }
        public DbSet<SchoolUser> SchoolUsers { get; set; }
        public DbSet<School> Schools { get; set; }
        public DbSet<SchoolSystem> SchoolSystems { get; set; }
        public DbSet<Grade> Grades { get; set; }
        public DbSet<Exam> Exams { get; set; }
        public DbSet<Absence> Absences { get; set; }
        public DbSet<AgendaEntry> AgendaEntries { get; set; }
        public DbSet<StudentDocument> StudentDocuments { get; set; }
        public DbSet<SemesterReport> SemesterReports { get; set; }
        public DbSet<SemesterSubjectGrade> SemesterSubjectGrades { get; set; }
        public DbSet<Teacher> Teachers { get; set; }
        public DbSet<DeviceToken> DeviceTokens { get; set; }
        public DbSet<NotificationPreference> NotificationPreferences { get; set; }
        public DbSet<NotificationOutbox> NotificationOutbox { get; set; }
        public DbSet<PendingPurge> PendingPurges { get; set; }
        public DbSet<InactivityWarning> InactivityWarnings { get; set; }
        public DbSet<VaultEntry> VaultEntries { get; set; }
        public DbSet<SecurityAuditEntry> SecurityAuditEntries { get; set; }
        public DbSet<LinkedAccount> LinkedAccounts { get; set; }
        public DbSet<PluginTask> PluginTasks { get; set; }
        public DbSet<McpOAuthClient> McpOAuthClients { get; set; }
        public DbSet<McpGrant> McpGrants { get; set; }
        public DbSet<McpAuthorizationCode> McpAuthorizationCodes { get; set; }
        public DbSet<McpToken> McpTokens { get; set; }
        public DbSet<McpApiKey> McpApiKeys { get; set; }
        public DbSet<McpActivity> McpActivities { get; set; }
        public DbSet<HelplyConversation> HelplyConversations { get; set; }
        public DbSet<HelplySettings> HelplySettings { get; set; }
        public DbSet<HelplyAttachment> HelplyAttachments { get; set; }
        public DbSet<HelplyAttachmentContent> HelplyAttachmentContents { get; set; }

        public SchulyDbContext(DbContextOptions<SchulyDbContext> options) : base(options) { }

        // Normalises every DateTime property to UTC on the way in so no individual command has to.
        protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
        {
            base.ConfigureConventions(configurationBuilder);

            configurationBuilder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
            configurationBuilder.Properties<DateTime?>().HaveConversion<UtcNullableDateTimeConverter>();
        }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            modelBuilder.ApplyToamaisutaaConfiguration(Database);

            modelBuilder.Entity<ApplicationUser>(entity =>
            {
                entity.HasKey(au => au.Id);
                entity.HasIndex(au => au.ExternalId).IsUnique();
                // ExternalId is the identity key; email isn't reliably unique across
                // IdPs and the OIDC sync writes it blindly, so keep it indexed but
                // not unique to avoid a login-time collision.
                entity.HasIndex(au => au.Email);
                entity.Property(au => au.Email).HasMaxLength(255);
                entity.Property(au => au.DisplayName).HasMaxLength(200);

                entity.HasMany(au => au.SchoolUsers)
                    .WithOne(su => su.ApplicationUser)
                    .HasForeignKey(su => su.ApplicationUserId)
                    .OnDelete(DeleteBehavior.Restrict);
            });

            modelBuilder.Entity<School>(entity =>
            {
                entity.HasKey(s => s.Id);
                entity.Property(s => s.Name).HasMaxLength(200).IsRequired();
                entity.Property(s => s.Description).HasMaxLength(1000);
                entity.Property(s => s.Email).HasMaxLength(255);
                entity.Property(s => s.PhoneNumber).HasMaxLength(50);
                entity.Property(s => s.Website).HasMaxLength(255);
                entity.Property(s => s.Street).HasMaxLength(200);
                entity.Property(s => s.City).HasMaxLength(100);
                entity.Property(s => s.State).HasMaxLength(100);
                entity.Property(s => s.Zip).HasMaxLength(20);
                entity.Property(s => s.Country).HasMaxLength(100);
                entity.HasIndex(s => s.Name);

                entity.HasMany(s => s.SchoolUsers)
                    .WithOne(su => su.School)
                    .HasForeignKey(su => su.SchoolId)
                    .OnDelete(DeleteBehavior.Restrict);

                entity.HasMany(s => s.Classes)
                    .WithOne(c => c.School)
                    .HasForeignKey(c => c.SchoolId)
                    .OnDelete(DeleteBehavior.Restrict);
            });

            modelBuilder.Entity<SchoolSystem>(entity =>
            {
                entity.HasKey(s => s.Id);
                // Key is the stable identifier the app and the config seeder match on.
                entity.HasIndex(s => s.Key).IsUnique();
                entity.Property(s => s.Key).HasMaxLength(50).IsRequired();
                entity.Property(s => s.DisplayName).HasMaxLength(200).IsRequired();
                entity.Property(s => s.LogoUrl).HasMaxLength(2000);
                entity.Property(s => s.PrivateAuthStrategy).HasMaxLength(50);
                entity.Property(s => s.LoginMethod).HasMaxLength(50).IsRequired();

                // Field descriptors are a small, always-loaded-together list — store
                // them as JSON on the row rather than a separate table.
                entity.OwnsMany(s => s.LoginFields, b =>
                {
                    b.ToJson();
                    b.OwnsMany(f => f.Suggestions);
                });
            });

            modelBuilder.Entity<SchoolUser>(entity =>
            {
                entity.HasKey(su => su.Id);
                // One SchoolUser per (Schuly account, school, email). The Schuly user
                // scopes uniqueness so the same student can be connected from more than
                // one Schuly account; each account provisions its own SchoolUser.
                entity.HasIndex(su => new { su.ApplicationUserId, su.SchoolId, su.Email }).IsUnique();
                entity.Property(su => su.Email).HasMaxLength(255);
                entity.Property(su => su.PrivateEmail).HasMaxLength(255);
                entity.Property(su => su.PhoneNumber).HasMaxLength(50);
                entity.Property(su => su.FirstName).HasMaxLength(100);
                entity.Property(su => su.LastName).HasMaxLength(100);
                entity.Property(su => su.Street).HasMaxLength(200);
                entity.Property(su => su.City).HasMaxLength(100);
                entity.Property(su => su.Zip).HasMaxLength(20);
                entity.Property(su => su.Source).HasMaxLength(SourceMaxLength);
                entity.Property(su => su.Role).IsRequired();

                entity.HasOne(su => su.ApplicationUser)
                    .WithMany(au => au.SchoolUsers)
                    .HasForeignKey(su => su.ApplicationUserId)
                    .OnDelete(DeleteBehavior.Restrict);

                entity.HasOne(su => su.School)
                    .WithMany(s => s.SchoolUsers)
                    .HasForeignKey(su => su.SchoolId)
                    .OnDelete(DeleteBehavior.Restrict);

                entity.HasIndex(su => new { su.ApplicationUserId, su.SchoolId });
                entity.HasIndex(su => new { su.SchoolId, su.Role });
            });

            modelBuilder.Entity<Grade>(entity =>
            {
                entity.HasKey(g => g.Id);
                // Swiss grades: 1.00–6.00 with 0.25/0.5 steps; weighting 0.00–9.99.
                entity.Property(g => g.Score).HasPrecision(4, 2);
                entity.Property(g => g.Weighting).HasPrecision(4, 2);
                entity.HasOne(g => g.SchoolUser)
                    .WithMany(su => su.Grades)
                    .HasForeignKey(g => g.SchoolUserId)
                    .OnDelete(DeleteBehavior.Cascade);

                entity.HasOne(g => g.Exam)
                    .WithMany(e => e.Grades)
                    .HasForeignKey(g => g.ExamId)
                    .OnDelete(DeleteBehavior.Cascade);

                entity.HasIndex(g => new { g.SchoolUserId, g.ExamId });
                // Standalone ExamId index supports "all grades for exam X" —
                // a composite (SchoolUserId, ExamId) only helps when filtering
                // by the leading column.
                entity.HasIndex(g => g.ExamId);
                ConfigureSynced(entity, g => new { g.SchoolUserId, g.Source, g.ExternalId });
            });

            modelBuilder.Entity<Exam>(entity =>
            {
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Name).HasMaxLength(200);
                entity.Property(e => e.Source).HasMaxLength(SourceMaxLength);
                // EF creates an FK index on ClassId automatically.
                // Composite for "exams in class X ordered by date".
                entity.HasIndex(e => new { e.ClassId, e.Date });

                entity.HasOne(e => e.Class)
                    .WithMany(c => c.Exams)
                    .HasForeignKey(e => e.ClassId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<Class>(entity =>
            {
                entity.HasKey(c => c.Id);
                entity.Property(c => c.Name).HasMaxLength(100);
                entity.Property(c => c.Description).HasMaxLength(1000);
                entity.Property(c => c.Source).HasMaxLength(SourceMaxLength);
                // Name unique per school — different schools can both have a "Math" class.
                // The leading SchoolId also serves FK lookups, so no separate index.
                entity.HasIndex(c => new { c.SchoolId, c.Name }).IsUnique();

                entity.HasMany(c => c.Students)
                      .WithMany(su => su.Classes);
                entity.HasMany(c => c.Teachers)
                      .WithMany(t => t.Classes);

                entity.HasOne(c => c.School)
                    .WithMany(s => s.Classes)
                    .HasForeignKey(c => c.SchoolId)
                    .OnDelete(DeleteBehavior.Restrict);
            });

            modelBuilder.Entity<Teacher>(entity =>
            {
                entity.HasKey(t => t.Id);
                entity.Property(t => t.FirstName).HasMaxLength(100).IsRequired();
                entity.Property(t => t.LastName).HasMaxLength(100).IsRequired();
                entity.Property(t => t.Code).HasMaxLength(20).IsRequired();
                entity.Property(t => t.Email).HasMaxLength(255);

                entity.HasOne(t => t.School)
                    .WithMany(s => s.Teachers)
                    .HasForeignKey(t => t.SchoolId)
                    .OnDelete(DeleteBehavior.Restrict);

                entity.HasOne(t => t.ApplicationUser)
                    .WithMany(au => au.Teachers)
                    .HasForeignKey(t => t.ApplicationUserId)
                    .OnDelete(DeleteBehavior.SetNull);

                // Kürzel uniquely identifies a teacher within a school.
                entity.HasIndex(t => new { t.SchoolId, t.Code }).IsUnique();
                entity.HasIndex(t => t.ApplicationUserId);
            });

            modelBuilder.Entity<AgendaEntry>(entity =>
            {
                entity.HasKey(ae => ae.Id);
                entity.Property(ae => ae.Title).HasMaxLength(200);
                // Composite supports "events for class X around date Y" without
                // a separate index on Date alone.
                entity.HasIndex(ae => new { ae.ClassId, ae.Date });
                // Mirror the (scope, Date) pattern for school-wide + personal
                // scopes so each is fast for "events between two dates".
                entity.HasIndex(ae => new { ae.SchoolId, ae.Date });
                entity.HasIndex(ae => new { ae.SchoolUserId, ae.Date });
                ConfigureSynced(entity, ae => new { ae.SchoolUserId, ae.Source, ae.ExternalId });

                entity.HasOne(ae => ae.Class)
                    .WithMany(c => c.Agenda)
                    .HasForeignKey(ae => ae.ClassId)
                    .OnDelete(DeleteBehavior.Cascade);

                entity.HasOne(ae => ae.School)
                    .WithMany(s => s.Agenda)
                    .HasForeignKey(ae => ae.SchoolId)
                    .OnDelete(DeleteBehavior.Cascade);

                entity.HasOne(ae => ae.SchoolUser)
                    .WithMany(su => su.Agenda)
                    .HasForeignKey(ae => ae.SchoolUserId)
                    .OnDelete(DeleteBehavior.Cascade);

                entity.ToTable(t =>
                {
                    // Exactly one of ClassId / SchoolId / SchoolUserId must be set.
                    t.HasCheckConstraint(
                        "CK_AgendaEntry_ExactlyOneScope",
                        "(CASE WHEN \"ClassId\" IS NULL THEN 0 ELSE 1 END" +
                        " + CASE WHEN \"SchoolId\" IS NULL THEN 0 ELSE 1 END" +
                        " + CASE WHEN \"SchoolUserId\" IS NULL THEN 0 ELSE 1 END) = 1");
                    // EndDate, when set, must not precede Date.
                    t.HasCheckConstraint(
                        "CK_AgendaEntry_EndDateAfterDate",
                        "\"EndDate\" IS NULL OR \"EndDate\" >= \"Date\"");
                });
            });

            modelBuilder.Entity<Absence>(entity =>
            {
                entity.HasKey(a => a.Id);
                entity.Property(a => a.Reason).HasMaxLength(500);

                entity.HasOne(a => a.SchoolUser)
                    .WithMany(su => su.Absences)
                    .HasForeignKey(a => a.SchoolUserId)
                    .OnDelete(DeleteBehavior.Cascade);

                entity.HasIndex(a => new { a.SchoolUserId, a.From, a.Until, a.Type });
                ConfigureSynced(entity, a => new { a.SchoolUserId, a.Source, a.ExternalId });

                // From must precede Until — otherwise period math downstream
                // (durations, overlaps) silently produces nonsense.
                entity.ToTable(t => t.HasCheckConstraint(
                    "CK_Absence_FromBeforeUntil",
                    "\"From\" <= \"Until\""));
            });

            modelBuilder.Entity<StudentDocument>(entity =>
            {
                entity.HasKey(d => d.Id);
                entity.Property(d => d.Title).HasMaxLength(300).IsRequired();
                entity.Property(d => d.Comment).HasMaxLength(2000);
                entity.Property(d => d.Category).HasMaxLength(100);
                entity.Property(d => d.EnteredBy).HasMaxLength(200);
                entity.Property(d => d.FileName).HasMaxLength(300);
                entity.Property(d => d.FileUrl).HasMaxLength(2000);
                entity.Property(d => d.FollowUpAction).HasMaxLength(500);

                entity.HasOne(d => d.SchoolUser)
                    .WithMany(su => su.Documents)
                    .HasForeignKey(d => d.SchoolUserId)
                    .OnDelete(DeleteBehavior.Cascade);

                entity.HasIndex(d => new { d.SchoolUserId, d.Category });
                ConfigureSynced(entity, d => new { d.SchoolUserId, d.Source, d.ExternalId });
            });

            modelBuilder.Entity<SemesterReport>(entity =>
            {
                entity.HasKey(r => r.Id);
                entity.Property(r => r.ProgramCode).HasMaxLength(50).IsRequired();
                entity.Property(r => r.ClassName).HasMaxLength(100).IsRequired();
                entity.Property(r => r.PromotionDecision).HasMaxLength(100);
                entity.Property(r => r.GradeAverage).HasPrecision(4, 2);
                entity.Property(r => r.Source).HasMaxLength(SourceMaxLength);

                entity.HasOne(r => r.SchoolUser)
                    .WithMany(su => su.SemesterReports)
                    .HasForeignKey(r => r.SchoolUserId)
                    .OnDelete(DeleteBehavior.Cascade);

                // One report per student × program × semester.
                entity.HasIndex(r => new { r.SchoolUserId, r.ProgramCode, r.SchoolYearStart, r.SemesterHalf })
                    .IsUnique();

                entity.ToTable(t => t.HasCheckConstraint(
                    "CK_SemesterReport_SemesterHalf",
                    "\"SemesterHalf\" IN (1, 2)"));
            });

            modelBuilder.Entity<SemesterSubjectGrade>(entity =>
            {
                entity.HasKey(sg => sg.Id);
                entity.Property(sg => sg.SubjectCode).HasMaxLength(50).IsRequired();
                entity.Property(sg => sg.SubjectName).HasMaxLength(200).IsRequired();
                entity.Property(sg => sg.SubjectTypeMarker).HasMaxLength(10);
                entity.Property(sg => sg.Grade).HasPrecision(4, 2);
                entity.Property(sg => sg.Marker).HasMaxLength(20);

                entity.HasOne(sg => sg.SemesterReport)
                    .WithMany(r => r.Subjects)
                    .HasForeignKey(sg => sg.SemesterReportId)
                    .OnDelete(DeleteBehavior.Cascade);

                entity.HasIndex(sg => new { sg.SemesterReportId, sg.SubjectCode }).IsUnique();
            });

            modelBuilder.Entity<DeviceToken>(entity =>
            {
                entity.HasKey(t => t.Id);
                entity.HasIndex(t => t.Token).IsUnique();
                entity.Property(t => t.Token).HasMaxLength(500).IsRequired();
                entity.Property(t => t.Platform).HasMaxLength(20).IsRequired();
                entity.Property(t => t.Locale).HasMaxLength(10).IsRequired();
                entity.HasIndex(t => t.ApplicationUserId);

                entity.HasOne(t => t.ApplicationUser)
                    .WithMany()
                    .HasForeignKey(t => t.ApplicationUserId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<LinkedAccount>(entity =>
            {
                entity.HasKey(a => a.Id);
                entity.Property(a => a.Provider).HasMaxLength(50).IsRequired();
                entity.Property(a => a.ExternalId).HasMaxLength(200).IsRequired();
                entity.Property(a => a.Email).HasMaxLength(320).IsRequired();
                entity.Property(a => a.DisplayName).HasMaxLength(200);
                entity.HasIndex(a => new { a.ApplicationUserId, a.Provider, a.ExternalId }).IsUnique();

                entity.HasOne(a => a.ApplicationUser)
                    .WithMany()
                    .HasForeignKey(a => a.ApplicationUserId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<McpOAuthClient>(entity =>
            {
                entity.HasKey(c => c.Id);
                entity.Property(c => c.ClientId).HasMaxLength(64).IsRequired();
                entity.Property(c => c.ClientName).HasMaxLength(200).IsRequired();
                entity.Property(c => c.ClientUri).HasMaxLength(2000);
                entity.Property(c => c.SoftwareId).HasMaxLength(200);
                entity.Property(c => c.SoftwareVersion).HasMaxLength(100);
                entity.Property(c => c.RegistrationIpHash).HasMaxLength(64);
                entity.HasIndex(c => c.ClientId).IsUnique();
                entity.HasIndex(c => new { c.RegistrationIpHash, c.CreatedAt });
            });

            modelBuilder.Entity<McpGrant>(entity =>
            {
                entity.HasKey(g => g.Id);
                entity.Property(g => g.SecurityStamp).HasMaxLength(256);
                entity.Property(g => g.Permissions).HasConversion(McpPermissionJson.Converter, McpPermissionJson.Comparer).IsRequired();
                entity.HasIndex(g => new { g.ApplicationUserId, g.McpOAuthClientId });

                entity.HasOne(g => g.ApplicationUser)
                    .WithMany()
                    .HasForeignKey(g => g.ApplicationUserId)
                    .OnDelete(DeleteBehavior.Cascade);

                entity.HasOne(g => g.McpOAuthClient)
                    .WithMany()
                    .HasForeignKey(g => g.McpOAuthClientId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<McpAuthorizationCode>(entity =>
            {
                entity.HasKey(c => c.Id);
                entity.Property(c => c.CodeHash).HasMaxLength(64).IsRequired();
                entity.Property(c => c.RedirectUri).HasMaxLength(2000).IsRequired();
                entity.Property(c => c.CodeChallenge).HasMaxLength(128).IsRequired();
                entity.Property(c => c.Resource).HasMaxLength(2000).IsRequired();
                entity.HasIndex(c => c.CodeHash).IsUnique();
                entity.HasIndex(c => c.ExpiresAt);

                entity.HasOne(c => c.McpGrant)
                    .WithMany()
                    .HasForeignKey(c => c.McpGrantId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<McpToken>(entity =>
            {
                entity.HasKey(t => t.Id);
                entity.Property(t => t.TokenHash).HasMaxLength(64).IsRequired();
                entity.Property(t => t.Resource).HasMaxLength(2000).IsRequired();
                entity.Property(t => t.Permissions).HasConversion(McpPermissionJson.NullableConverter, McpPermissionJson.NullableComparer);
                entity.HasIndex(t => t.TokenHash).IsUnique();
                entity.HasIndex(t => t.ExpiresAt);
                entity.HasIndex(t => t.McpGrantId);

                entity.HasOne(t => t.ApplicationUser)
                    .WithMany()
                    .HasForeignKey(t => t.ApplicationUserId)
                    .OnDelete(DeleteBehavior.Cascade);

                entity.HasOne(t => t.McpGrant)
                    .WithMany()
                    .HasForeignKey(t => t.McpGrantId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<McpApiKey>(entity =>
            {
                entity.HasKey(k => k.Id);
                entity.Property(k => k.Name).HasMaxLength(100).IsRequired();
                entity.Property(k => k.Prefix).HasMaxLength(32).IsRequired();
                entity.Property(k => k.KeyHash).HasMaxLength(64).IsRequired();
                entity.Property(k => k.Permissions).HasConversion(McpPermissionJson.Converter, McpPermissionJson.Comparer).IsRequired();
                entity.HasIndex(k => k.KeyHash).IsUnique();
                entity.HasIndex(k => k.ApplicationUserId);

                entity.HasOne(k => k.ApplicationUser)
                    .WithMany()
                    .HasForeignKey(k => k.ApplicationUserId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<McpActivity>(entity =>
            {
                entity.HasKey(a => a.Id);
                entity.Property(a => a.ToolName).HasMaxLength(100).IsRequired();
                entity.HasIndex(a => new { a.McpGrantId, a.CreatedAt });
                entity.HasIndex(a => new { a.McpApiKeyId, a.CreatedAt });
                entity.HasIndex(a => a.CreatedAt);

                entity.HasOne(a => a.ApplicationUser)
                    .WithMany()
                    .HasForeignKey(a => a.ApplicationUserId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<HelplyConversation>(entity =>
            {
                entity.HasKey(c => c.Id);
                entity.Property(c => c.Title).IsRequired();
                entity.Property(c => c.Transcript).IsRequired();
                entity.HasIndex(c => new { c.ApplicationUserId, c.LastActivityAt });
                entity.HasIndex(c => c.ExpiresAt);

                entity.HasOne(c => c.ApplicationUser)
                    .WithMany()
                    .HasForeignKey(c => c.ApplicationUserId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<HelplyAttachment>(entity =>
            {
                entity.HasKey(a => a.Id);
                entity.Property(a => a.FileName).IsRequired();
                entity.Property(a => a.MediaType).HasMaxLength(200).IsRequired();
                entity.HasIndex(a => new { a.ConversationId, a.MessageId });
                entity.HasIndex(a => new { a.MessageId, a.CreatedAt });
                entity.HasIndex(a => a.ApplicationUserId);

                entity.HasOne(a => a.ApplicationUser)
                    .WithMany()
                    .HasForeignKey(a => a.ApplicationUserId)
                    .OnDelete(DeleteBehavior.Cascade);
                entity.HasOne(a => a.Conversation)
                    .WithMany()
                    .HasForeignKey(a => a.ConversationId)
                    .OnDelete(DeleteBehavior.Cascade);
                entity.HasOne(a => a.Content)
                    .WithOne()
                    .HasForeignKey<HelplyAttachmentContent>(c => c.AttachmentId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<HelplyAttachmentContent>(entity =>
            {
                entity.HasKey(c => c.AttachmentId);
                entity.Property(c => c.Data).IsRequired();
            });

            modelBuilder.Entity<HelplySettings>(entity =>
            {
                entity.HasKey(s => s.Id);
                entity.Property(s => s.Permissions).HasConversion(McpPermissionJson.Converter, McpPermissionJson.Comparer).IsRequired();
                entity.HasIndex(s => s.ApplicationUserId).IsUnique();

                entity.HasOne(s => s.ApplicationUser)
                    .WithMany()
                    .HasForeignKey(s => s.ApplicationUserId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<NotificationPreference>(entity =>
            {
                entity.HasKey(p => p.Id);
                entity.HasIndex(p => p.ApplicationUserId).IsUnique();

                entity.HasOne(p => p.ApplicationUser)
                    .WithMany()
                    .HasForeignKey(p => p.ApplicationUserId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<PendingPurge>(entity =>
            {
                entity.HasKey(p => p.Id);
                entity.Property(p => p.Target).HasMaxLength(1024).IsRequired();
                entity.Property(p => p.PluginSource).HasMaxLength(200);
            });

            modelBuilder.Entity<InactivityWarning>(entity =>
            {
                entity.HasKey(w => w.LoginId);
            });

            modelBuilder.Entity<NotificationOutbox>(entity =>
            {
                entity.HasKey(o => o.Id);
                entity.Property(o => o.SubjectName).HasMaxLength(200);
                entity.Property(o => o.Summary).HasMaxLength(300);
                entity.Property(o => o.LastError).HasMaxLength(1000);
                // The drain query polls for due, pending rows.
                entity.HasIndex(o => new { o.Status, o.NextAttemptAt });
                entity.HasIndex(o => o.ApplicationUserId);
                // No FK to ApplicationUser: this is a queue, not a relation - rows must
                // survive independently of the user row (and of sync ordering) until drained.
            });

            modelBuilder.Entity<VaultEntry>(entity =>
            {
                entity.HasKey(v => v.Id);
                entity.Property(v => v.PluginName).HasMaxLength(200).IsRequired();
                entity.Property(v => v.Key).HasMaxLength(200).IsRequired();
                entity.HasIndex(v => new { v.PluginName, v.Key }).IsUnique();
            });

            modelBuilder.Entity<SecurityAuditEntry>(entity =>
            {
                entity.HasKey(a => a.Id);
                entity.Property(a => a.Kind).HasMaxLength(64).IsRequired();
                entity.Property(a => a.Detail).HasMaxLength(64);
                entity.HasIndex(a => a.OccurredAt);
                entity.HasIndex(a => a.UserId);
                // No FK to the user: the trail has to outlive the account it describes, until its retention limit.
            });

            modelBuilder.Entity<PluginTask>(entity =>
            {
                entity.HasKey(t => t.Id);
                entity.Property(t => t.PluginName).HasMaxLength(200).IsRequired();
                entity.Property(t => t.TaskName).HasMaxLength(200).IsRequired();
                entity.Property(t => t.Cron).HasMaxLength(100).IsRequired();
                entity.Property(t => t.LastStatus).HasMaxLength(20).IsRequired();
                entity.Property(t => t.LastError).HasMaxLength(2000);
                entity.HasIndex(t => new { t.PluginName, t.TaskName }).IsUnique();
            });
        }

        public const int SourceMaxLength = 200;
        public const int ExternalIdMaxLength = 300;

        private static void ConfigureSynced<T>(EntityTypeBuilder<T> entity, Expression<Func<T, object?>> syncKey) where T : class, ISyncedEntity
        {
            entity.Property(e => e.Source).HasMaxLength(SourceMaxLength);
            entity.Property(e => e.ExternalId).HasMaxLength(ExternalIdMaxLength);
            entity.HasIndex(syncKey).IsUnique().HasFilter("\"Source\" IS NOT NULL");
        }

        public override int SaveChanges()
        {
            UpdateDateTrackingFields();
            return base.SaveChanges();
        }

        public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            UpdateDateTrackingFields();
            return base.SaveChangesAsync(cancellationToken);
        }

        private void UpdateDateTrackingFields()
        {
            var entries = ChangeTracker.Entries<Base>().Where(e => e.State == EntityState.Added || e.State == EntityState.Modified);

            foreach (var entry in entries)
            {
                if (entry.State == EntityState.Added)
                {
                    entry.Entity.CreatedAt = DateTime.UtcNow;
                    entry.Entity.UpdatedAt = DateTime.UtcNow;
                }

                if (entry.State == EntityState.Modified)
                    entry.Entity.UpdatedAt = DateTime.UtcNow;
            }
        }
    }
}
