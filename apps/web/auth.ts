import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        // This fetch leaves Vercel's server, not the visitor's browser, so the
        // API sees Vercel's egress IP for every sign-in attempt. Its rate
        // limiter keys on that IP, which made the 5/minute login limit apply to
        // the whole application at once instead of per user — one person
        // retrying locked out everyone. Forward the visitor's address so the
        // limit is counted against them individually.
        const forwardedFor =
          request?.headers?.get?.("x-forwarded-for") ??
          request?.headers?.get?.("x-real-ip") ??
          "";

        // Every failure below has to return null — NextAuth's contract — which
        // the UI renders as "Invalid email or password" regardless of the real
        // cause. A wrong API_URL, a 429, a 500 and genuinely bad credentials
        // are indistinguishable on screen, so log the actual reason here. These
        // land in the Vercel runtime logs; never log the password.
        try {
          const res = await fetch(`${API_URL}/auth/login`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
            },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          });

          if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.error(
              `[auth] login failed: ${res.status} ${res.statusText} ` +
                `url=${API_URL}/auth/login body=${body.slice(0, 300)}`,
            );
            return null;
          }

          const data = await res.json();
          if (!data?.user?.id || !data?.access_token) {
            console.error(
              `[auth] login returned 200 but the payload was not the expected ` +
                `shape. keys=${Object.keys(data ?? {}).join(",")}`,
            );
            return null;
          }

          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.full_name,
            accessToken: data.access_token,
            role: data.user.role,
          };
        } catch (e: unknown) {
          // Thrown before any response: DNS failure, refused connection, or
          // API_URL left at the localhost default, which is unreachable from
          // Vercel's servers.
          console.error(
            `[auth] login threw before a response. url=${API_URL}/auth/login ` +
              `error=${e instanceof Error ? e.message : String(e)}`,
          );
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = (user as { accessToken: string }).accessToken;
        token.role = (user as { role: string }).role;
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      (session as { accessToken?: string }).accessToken = token.accessToken as string;
      (session.user as { role?: string }).role = token.role as string;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
});
