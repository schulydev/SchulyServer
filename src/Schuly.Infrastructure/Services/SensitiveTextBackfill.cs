using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Schuly.Infrastructure.Services
{
    /// <summary>Encrypts rows written before <see cref="SensitiveText"/> existed and, during a vault key rotation, moves rows to the new key. Rows stay readable meanwhile, so it can stop and resume at any point, and an update only applies if the value is still the one it read.</summary>
    public sealed class SensitiveTextBackfill(SchulyDbContext db, ILogger<SensitiveTextBackfill> logger)
    {
        private const int BatchSize = 500;

        private static readonly (string Table, string Column)[] Targets =
        [
            ("Absences", "Reason"),
            ("StudentDocuments", "Title"),
            ("StudentDocuments", "Comment"),
            ("StudentDocuments", "Category"),
            ("StudentDocuments", "EnteredBy"),
            ("StudentDocuments", "FileName"),
            ("StudentDocuments", "FollowUpAction"),
        ];

        private sealed record Row(Guid Id, string Value);

        private async Task<int> RotateAsync(CancellationToken cancellationToken)
        {
            var total = 0;
            foreach (var (table, column) in Targets)
            {
                var rows = await db.Database
                    .SqlQueryRaw<Row>("SELECT \"Id\", \"" + column + "\" AS \"Value\" FROM \"" + table + "\" WHERE \"" + column + "\" LIKE '" + SensitiveText.Prefix + "%'")
                    .ToListAsync(cancellationToken);

                foreach (var row in rows.Where(r => !SensitiveText.IsOnCurrentKey(r.Value)))
                {
                    var plaintext = SensitiveText.Reveal(row.Value);
                    if (plaintext != SensitiveText.Unreadable)
                        total += await db.Database.ExecuteSqlRawAsync("UPDATE \"" + table + "\" SET \"" + column + "\" = {0} WHERE \"Id\" = {1} AND \"" + column + "\" = {2}", [SensitiveText.Protect(plaintext), row.Id, row.Value], cancellationToken);
                }
            }
            return total;
        }

        public async Task<int> RunAsync(CancellationToken cancellationToken = default)
        {
            if (!db.Database.IsRelational())
                return 0;

            var total = 0;
            foreach (var (table, column) in Targets)
            {
                while (true)
                {
                    var rows = await db.Database
                        .SqlQueryRaw<Row>("SELECT \"Id\", \"" + column + "\" AS \"Value\" FROM \"" + table + "\" WHERE \"" + column + "\" IS NOT NULL AND \"" + column + "\" NOT LIKE '" + SensitiveText.Prefix + "%' LIMIT " + BatchSize)
                        .ToListAsync(cancellationToken);
                    if (rows.Count == 0)
                        break;

                    foreach (var row in rows)
                        total += await db.Database.ExecuteSqlRawAsync("UPDATE \"" + table + "\" SET \"" + column + "\" = {0} WHERE \"Id\" = {1} AND \"" + column + "\" = {2}", [SensitiveText.Protect(row.Value), row.Id, row.Value], cancellationToken);
                }
            }

            if (SensitiveText.Rotating)
                total += await RotateAsync(cancellationToken);

            if (total > 0)
                logger.LogInformation("Encrypted {Count} stored absence reasons and document fields.", total);
            return total;
        }
    }
}
