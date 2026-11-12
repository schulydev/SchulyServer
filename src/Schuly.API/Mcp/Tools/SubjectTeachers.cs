namespace Schuly.API.Mcp.Tools
{
    /// <summary>Teacher names out of Schulnetz lesson notes.</summary>
    public static class SubjectTeachers
    {
        /// <summary>
        /// Teacher names as far as the school passes them on: Schulnetz lessons carry them in the lesson note, so a note that looks like a short list of names
        /// (no digits, no sentence punctuation) counts, anything else is a comment and is ignored. The most frequent names come first, at most four.
        /// </summary>
        public static List<string> FromLessons(IEnumerable<string?> notes)
        {
            var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var note in notes)
            {
                if (string.IsNullOrWhiteSpace(note) || note.Length > 80)
                    continue;
                var parts = note.Split([',', ';', '/'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                if (parts.Length == 0 || parts.Any(p => p.Length > 40 || p.Split(' ').Length > 4 || p.Any(c => char.IsDigit(c) || c is '.' or '!' or '?' or ':') || !char.IsUpper(p[0])))
                    continue;
                foreach (var part in parts)
                    counts[part] = counts.GetValueOrDefault(part) + 1;
            }
            return counts.OrderByDescending(c => c.Value).ThenBy(c => c.Key, StringComparer.OrdinalIgnoreCase).Take(4).Select(c => c.Key).ToList();
        }
    }
}
