using Npgsql;

namespace Schuly.API.Plugins
{
    /// <summary>
    /// Reads which users a plugin database holds data for, from every uuid column named ApplicationUserId.
    /// The plugin contract has no way to ask a plugin or to tell it who still exists, so the host reads its
    /// plugins' databases for this, read-only. Deleting stays with the plugin's own purge handler.
    /// </summary>
    public static class PluginDataOwners
    {
        private const string ColumnsSql = """
            SELECT c.table_schema, c.table_name
            FROM information_schema.columns c
            JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE c.column_name = 'ApplicationUserId' AND c.data_type = 'uuid' AND t.table_type = 'BASE TABLE'
              AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
            """;

        /// <summary>Whether a plugin has a database at all. Asked on the main database, so a plugin without one causes no failed connection.</summary>
        public static async Task<bool> DatabaseExistsAsync(string mainConnectionString, string database, CancellationToken cancellationToken)
        {
            await using var connection = new NpgsqlConnection(mainConnectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new NpgsqlCommand("SELECT 1 FROM pg_database WHERE datname = @name", connection);
            command.Parameters.AddWithValue("name", database);
            return await command.ExecuteScalarAsync(cancellationToken) is not null;
        }

        public static async Task<IReadOnlyCollection<Guid>> ReadAsync(string connectionString, CancellationToken cancellationToken)
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellationToken);

            var tables = new List<string>();
            await using (var columns = new NpgsqlCommand(ColumnsSql, connection))
            await using (var reader = await columns.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                    tables.Add($"{Quote(reader.GetString(0))}.{Quote(reader.GetString(1))}");
            }

            var owners = new HashSet<Guid>();
            foreach (var table in tables)
            {
                await using var select = new NpgsqlCommand($"SELECT DISTINCT \"ApplicationUserId\" FROM {table} WHERE \"ApplicationUserId\" IS NOT NULL", connection);
                await using var reader = await select.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                    owners.Add(reader.GetGuid(0));
            }

            owners.Remove(Guid.Empty);
            return owners;
        }

        private static string Quote(string identifier) => $"\"{identifier.Replace("\"", "\"\"")}\"";
    }
}
