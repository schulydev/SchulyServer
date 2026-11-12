namespace Schuly.API.Mcp.Tools
{
    /// <summary>"Today" the way a Swiss student sees it, so a test tomorrow morning is still upcoming at 23:30 UTC.</summary>
    public static class SwissTime
    {
        public static DateOnly Today()
        {
            try
            {
                return DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Europe/Zurich")));
            }
            catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
            {
                return DateOnly.FromDateTime(DateTime.UtcNow);
            }
        }
    }
}
