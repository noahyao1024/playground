import nodemailer from "nodemailer";

/** Where the alert goes, and through which server: the SMTP_* variables and
 *  ALERT_TO, as .env.example describes them. */
export type MailConfig = { host: string; port: number; user: string; pass: string; from: string; to: string };

/** Null until SMTP_USERNAME and SMTP_PASSWORD are both set: then there is no
 *  mail, only the report the cron run returns. */
export function mailConfig(env: Record<string, string | undefined> = process.env): MailConfig | null {
  const user = env.SMTP_USERNAME?.trim();
  const pass = env.SMTP_PASSWORD;
  if (!user || !pass) return null;
  return {
    host: env.SMTP_SERVER?.trim() || "smtp.gmail.com",
    port: Number(env.SMTP_PORT || 465),
    user,
    pass,
    // Gmail sends only as an address verified under "Send mail as"; anything
    // else is rewritten to the account, so the account is the default.
    from: `Split Bill <${env.MAIL_FROM?.trim() || user}>`,
    to: env.ALERT_TO?.trim() || user,
  };
}

export async function sendMail(config: MailConfig, mail: { subject: string; text: string }): Promise<void> {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 465 speaks TLS from the first byte; 587 and 25 upgrade with STARTTLS.
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });
  await transport.sendMail({ from: config.from, to: config.to, subject: mail.subject, text: mail.text });
}
