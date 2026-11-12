using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Schuly.API.Mcp.Tools
{
    /// <summary>How well two names for a subject agree. <see cref="Exact"/>: the same name once case, accents, punctuation and year or class prefixes are ignored. <see cref="Alias"/>: two names of the same subject (Mathe / Mathematik / maths). <see cref="Fuzzy"/>: similar, not known to be the same.</summary>
    public enum SubjectMatch
    {
        None = 0,
        Fuzzy = 1,
        Alias = 2,
        Exact = 3,
    }

    /// <summary>A subject from the built-in table: a stable key, the name to show and every name it goes by in German, French, Italian and English.</summary>
    public sealed record SubjectInfo(string Key, string Name, IReadOnlyList<string> Aliases);

    /// <summary>
    /// Names and abbreviations of common Swiss school subjects, with the normalisation that makes "Mathe 4. LJ", "BM-Mathematik Grundlagen" and "maths" land on the same subject.
    /// Short abbreviations (up to three letters, such as MA or WR) only count when they are the whole name, so "de" in a sentence is never a subject.
    /// </summary>
    public static partial class SubjectAliases
    {
        private static readonly (string Key, string Name, string[] Aliases)[] Table =
        [
            ("math", "Mathematik", ["Mathematik", "Mathe", "Math", "Maths", "Mathematics", "MA", "MAT", "Mathématiques", "Matematica"]),
            ("wirtschaft-recht", "Wirtschaft und Recht", ["Wirtschaft und Recht", "Wirtschaft & Recht", "W&R", "WR", "WuR", "Wirtschaft", "Recht", "Economie et droit", "Économie et droit", "E&D", "Economia e diritto", "Economics and Law", "Business and Law"]),
            ("geschichte-politik", "Geschichte und Politik", ["Geschichte und Politik", "Geschichte & Politik", "G&P", "GP", "GuP", "Geschichte", "Politik", "Histoire et politique", "Histoire", "Storia e politica", "Storia", "History and Politics", "History"]),
            ("deutsch", "Deutsch", ["Deutsch", "DE", "DEU", "German", "Allemand", "Tedesco"]),
            ("englisch", "Englisch", ["Englisch", "EN", "ENG", "English", "Anglais", "Inglese"]),
            ("franzoesisch", "Französisch", ["Französisch", "Franzoesisch", "FR", "FRA", "Français", "Francais", "French", "Francese"]),
            ("italienisch", "Italienisch", ["Italienisch", "ITA", "Italiano", "Italian", "Italien"]),
            ("spanisch", "Spanisch", ["Spanisch", "ES", "ESP", "Español", "Espanol", "Spanish", "Espagnol", "Spagnolo"]),
            ("physik", "Physik", ["Physik", "PH", "PHY", "Phys", "Physics", "Physique", "Fisica"]),
            ("chemie", "Chemie", ["Chemie", "CH", "CHE", "Chemistry", "Chimie", "Chimica"]),
            ("biologie", "Biologie", ["Biologie", "BIO", "BI", "Biology", "Biologia"]),
            ("naturwissenschaften", "Naturwissenschaften", ["Naturwissenschaften", "Naturwissenschaft", "NW", "NaWi", "Natural Sciences", "Sciences naturelles", "Scienze naturali"]),
            ("abu", "Allgemeinbildung (ABU)", ["Allgemeinbildung", "Allgemeinbildender Unterricht", "ABU", "General Education", "Culture générale", "Cultura generale"]),
            ("sprache-kommunikation", "Sprache und Kommunikation", ["Sprache und Kommunikation", "Sprache & Kommunikation", "S&K", "SuK", "Langue et communication", "Lingua e comunicazione"]),
            ("gesellschaft", "Gesellschaft", ["Gesellschaft", "Society", "Société", "Societe", "Società", "Societa"]),
            ("sport", "Sport", ["Sport", "SP", "Sports", "Turnen", "Bewegung und Sport", "EPS", "Education physique", "Éducation physique", "Educazione fisica", "Physical Education", "PE"]),
            ("informatik", "Informatik", ["Informatik", "INF", "ICT", "IKT", "Computer Science", "Informatique", "Informatica"]),
            ("geografie", "Geografie", ["Geografie", "Geographie", "GEO", "Geography", "Géographie", "Geographie", "Geografia"]),
            ("musik", "Musik", ["Musik", "MU", "Music", "Musique", "Musica"]),
            ("gestalten", "Gestalten", ["Gestalten", "Bildnerisches Gestalten", "BG", "Kunst", "Art", "Arts visuels", "Arte"]),
            ("ethik-religion", "Ethik und Religion", ["Ethik und Religion", "Ethik", "Religion", "Éthique", "Etica", "Ethics"]),
            ("philosophie", "Philosophie", ["Philosophie", "Philosophy", "Filosofia"]),
            ("psychologie", "Psychologie", ["Psychologie", "Psychology", "Psicologia"]),
            ("berufskunde", "Berufskunde", ["Berufskunde", "Fachkunde", "BK", "Connaissances professionnelles", "Conoscenze professionali"]),
        ];

        private static readonly string[] NoiseWords = ["lj", "lehrjahr", "jahr", "sem", "semester", "semestre", "klasse", "kl", "year", "bm", "bms", "bm1", "bm2", "berufsmatura", "berufsmaturitat", "maturite", "maturita", "fach", "kurs"];

        private static readonly Dictionary<string, SubjectInfo> ByKey = Table.ToDictionary(t => t.Key, t => new SubjectInfo(t.Key, t.Name, t.Aliases.Distinct(StringComparer.OrdinalIgnoreCase).ToList()));

        // Aliases that are a single short token only match a whole name; the rest are phrases that may appear anywhere in a name, longest first.
        private static readonly Dictionary<string, string> ShortAliases = BuildShort();
        private static readonly List<(string[] Tokens, string Key)> Phrases = BuildPhrases();

        public static IReadOnlyCollection<SubjectInfo> All => ByKey.Values;

        /// <summary>Lower case, no accents, "&amp;" as "und", punctuation as single spaces: "Wirtschaft &amp; Recht" and "wirtschaft und recht" are equal.</summary>
        public static string Normalize(string? text)
        {
            if (string.IsNullOrWhiteSpace(text))
                return string.Empty;
            var decomposed = text.Trim().Normalize(NormalizationForm.FormD);
            var sb = new StringBuilder(decomposed.Length);
            foreach (var c in decomposed)
            {
                var category = CharUnicodeInfo.GetUnicodeCategory(c);
                if (category == UnicodeCategory.NonSpacingMark)
                    continue;
                if (c == '&')
                    sb.Append(" und ");
                else if (c == 'ß')
                    sb.Append("ss");
                else if (char.IsLetterOrDigit(c))
                    sb.Append(char.ToLowerInvariant(c));
                else
                    sb.Append(' ');
            }
            return Spaces().Replace(sb.ToString(), " ").Trim();
        }

        /// <summary>The normalised name without what only says which class or year it is: "Mathe 4. LJ", "BM23d Mathe" and "BM-Mathe" all become "mathe".</summary>
        public static string Clean(string? text)
        {
            var normalized = Normalize(text);
            var kept = normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(t => !IsNoise(t)).ToList();
            return kept.Count == 0 ? normalized : string.Join(' ', kept);
        }

        /// <summary>The subject from the table this name stands for, or null when it is not a known one.</summary>
        public static SubjectInfo? Resolve(string? text)
        {
            var clean = Clean(text);
            if (clean.Length == 0)
                return null;
            if (ShortAliases.TryGetValue(clean, out var shortKey))
                return ByKey[shortKey];
            var tokens = clean.Split(' ');
            foreach (var (phrase, key) in Phrases)
                if (Contains(tokens, phrase))
                    return ByKey[key];
            return null;
        }

        /// <summary>Every name the subject goes by, for searching: the table entry when the name is known, otherwise just the name itself.</summary>
        public static IReadOnlyList<string> AliasesOf(string? text) => Resolve(text)?.Aliases ?? (string.IsNullOrWhiteSpace(text) ? [] : [text.Trim()]);

        /// <summary>How well two names fit as the same subject.</summary>
        public static SubjectMatch Match(string? a, string? b)
        {
            var cleanA = Clean(a);
            var cleanB = Clean(b);
            if (cleanA.Length == 0 || cleanB.Length == 0)
                return SubjectMatch.None;
            if (cleanA == cleanB)
                return SubjectMatch.Exact;
            var subjectA = Resolve(a);
            var subjectB = Resolve(b);
            if (subjectA is not null && subjectB is not null)
                return subjectA.Key == subjectB.Key ? SubjectMatch.Alias : SubjectMatch.None;
            if (subjectA is not null || subjectB is not null)
            {
                var known = (subjectA ?? subjectB)!;
                var other = subjectA is null ? cleanA : cleanB;
                return known.Aliases.Select(Clean).Any(alias => alias.Length >= 4 && Close(alias, other)) ? SubjectMatch.Fuzzy : SubjectMatch.None;
            }
            return Close(cleanA, cleanB) ? SubjectMatch.Fuzzy : SubjectMatch.None;
        }

        private static bool Close(string a, string b)
        {
            if (a.Length < 4 || b.Length < 4)
                return false;
            if (Contains(a.Split(' '), b.Split(' ')) || Contains(b.Split(' '), a.Split(' ')))
                return true;
            return Distance(a, b) <= (Math.Max(a.Length, b.Length) >= 8 ? 2 : 1);
        }

        private static bool IsNoise(string token) => token.All(char.IsDigit) || NoiseWords.Contains(token) || ClassCode().IsMatch(token) || Ordinal().IsMatch(token);

        private static bool Contains(string[] tokens, string[] phrase)
        {
            for (var i = 0; i + phrase.Length <= tokens.Length; i++)
            {
                var j = 0;
                while (j < phrase.Length && tokens[i + j] == phrase[j])
                    j++;
                if (j == phrase.Length)
                    return true;
            }
            return false;
        }

        private static Dictionary<string, string> BuildShort()
        {
            var result = new Dictionary<string, string>();
            foreach (var (key, name, aliases) in Table)
                foreach (var alias in aliases.Append(name))
                {
                    var normalized = Normalize(alias);
                    if (normalized.Length is > 0 and <= 3 && !normalized.Contains(' ') && !result.ContainsKey(normalized))
                        result[normalized] = key;
                }
            return result;
        }

        private static List<(string[] Tokens, string Key)> BuildPhrases()
        {
            var result = new List<(string[] Tokens, string Key)>();
            foreach (var (key, name, aliases) in Table)
                foreach (var alias in aliases.Append(name))
                {
                    var normalized = Normalize(alias);
                    if (normalized.Length > 3 || normalized.Contains(' '))
                        result.Add((normalized.Split(' '), key));
                }
            return result.OrderByDescending(p => p.Tokens.Length).ThenByDescending(p => p.Tokens.Sum(t => t.Length)).ToList();
        }

        private static int Distance(string a, string b)
        {
            var previous = Enumerable.Range(0, b.Length + 1).ToArray();
            for (var i = 1; i <= a.Length; i++)
            {
                var current = new int[b.Length + 1];
                current[0] = i;
                for (var j = 1; j <= b.Length; j++)
                    current[j] = Math.Min(Math.Min(current[j - 1] + 1, previous[j] + 1), previous[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
                previous = current;
            }
            return previous[b.Length];
        }

        [GeneratedRegex(" +")]
        private static partial Regex Spaces();

        // Class codes such as bm23d, fr23a, ap24b, and school-year ordinals such as 4th, 2e, 3eme.
        [GeneratedRegex(@"^[a-z]{1,5}\d{1,2}[a-z]?$|^\d{2}[a-z]$")]
        private static partial Regex ClassCode();

        [GeneratedRegex(@"^\d+(st|nd|rd|th|e|er|eme|ere|re)$")]
        private static partial Regex Ordinal();
    }
}
