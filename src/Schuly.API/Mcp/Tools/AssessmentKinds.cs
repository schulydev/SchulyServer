namespace Schuly.API.Mcp.Tools
{
    /// <summary>Recognises tests, presentations and hand-ins in the free text of an agenda entry, in German, French, Italian and English.</summary>
    public static class AssessmentKinds
    {
        public const string Exam = "exam";
        public const string Presentation = "presentation";
        public const string HandIn = "hand-in";
        public const string Other = "other";

        // Words a token may merely contain: long and specific enough that German compounds (Mathetest, Projektabgabe, Schlusspruefung) are caught too.
        private static readonly string[] PresentationParts = ["prasentation", "praesentation", "presentation", "presentazione", "vortrag", "referat", "expose", "exposition"];
        private static readonly string[] ExamParts = ["prufung", "pruefung", "lernkontrolle", "klausur", "epreuve", "controle", "interrogation", "mundlich", "muendlich", "verific"];
        private static readonly string[] HandInParts = ["abgabe", "abgeben", "einreichen", "projekt", "project", "projet", "progetto", "hausarbeit", "deadline", "submission", "consegna", "portfolio"];

        // Short words only count as whole tokens, so "test" is found but "latest" and "contest" are not.
        private static readonly string[] ExamWords = ["test", "tests", "lk", "lks", "exam", "exams", "examen", "examens", "esame", "esami", "quiz", "oral", "orale", "orali"];
        private static readonly string[] HandInWords = ["rendu", "hand", "handin"];
        private static readonly string[] NotATest = ["protest", "kontest", "contest", "attest", "latest", "detest"];
        private static readonly string[] Negations = ["kein", "keine", "keiner", "keinen", "ohne", "no", "not", "pas", "sans", "nessun", "nessuna", "senza"];

        /// <summary>
        /// The kind of assessment the text announces (exam, presentation, hand-in), or null when it announces none. A presentation wins over an exam, an exam over a hand-in
        /// ("Projektprüfung" is an exam, "Abgabe Projekt" a hand-in). A word right after "kein", "ohne", "no" and the like does not count.
        /// </summary>
        public static string? Classify(string? title, string? description)
        {
            var tokens = SubjectAliases.Normalize(title + " " + (description is { Length: > 300 } ? description[..300] : description)).Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var presentation = false;
            var exam = false;
            var handIn = false;
            for (var i = 0; i < tokens.Length; i++)
            {
                if (i > 0 && Negations.Contains(tokens[i - 1]))
                    continue;
                var t = tokens[i];
                if (PresentationParts.Any(t.Contains))
                    presentation = true;
                else if (ExamParts.Any(t.Contains) || ExamWords.Contains(t) || (t.Length >= 7 && t.EndsWith("test", StringComparison.Ordinal) && !NotATest.Contains(t)))
                    exam = true;
                else if (HandInParts.Any(t.Contains) || HandInWords.Contains(t) && (t != "hand" || (i + 1 < tokens.Length && tokens[i + 1] == "in")))
                    handIn = true;
            }
            return presentation ? Presentation : exam ? Exam : handIn ? HandIn : null;
        }
    }
}
