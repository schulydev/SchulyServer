using System.Net;
using System.Net.Sockets;

namespace Schuly.API.Services
{
    public static class NetworkAddresses
    {
        /// <summary>True for addresses that aren't globally routable: loopback, private, link-local, carrier-grade NAT, multicast and reserved ranges.</summary>
        public static bool IsPrivate(IPAddress address)
        {
            var ip = address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;
            var b = ip.GetAddressBytes();

            if (ip.AddressFamily == AddressFamily.InterNetwork)
                return b[0] is 0 or 10 or 127 || b[0] >= 224 || (b[0] == 100 && b[1] is >= 64 and <= 127) || (b[0] == 169 && b[1] == 254) || (b[0] == 172 && b[1] is >= 16 and <= 31) || (b[0] == 192 && b[1] == 168);

            // Only 2000::/3 is global unicast. That leaves out ::1, fc00::/7, fe80::/10 and ff00::/8.
            return (b[0] & 0xe0) != 0x20;
        }
    }
}
