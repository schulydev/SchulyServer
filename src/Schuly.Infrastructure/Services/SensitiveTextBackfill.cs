using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Schuly.Infrastructure.Services
{
    /// <summary>Encrypts rows written before <see cref="SensitiveText"/> existed. Plain rows stay readable meanwhile, so it can stop and resume at any point, and an update only applies if the value is still the one it read.</summary>
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

            if (total > 0)
                logger.LogInformation("Encrypted {Count} stored absence reasons and document fields.", total);
            return total;
        }
    }
}
