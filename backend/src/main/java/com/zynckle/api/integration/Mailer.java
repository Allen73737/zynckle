package com.zynckle.api.integration;

import com.zynckle.api.ai.AiSettings;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.stereotype.Component;

import java.util.Properties;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Outgoing email over SMTP (SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM).
 * Without SMTP_HOST nothing is sent: links are logged instead, exactly as before. Sending runs
 * on a background thread so a slow mail server never delays an API response.
 */
@Component
public class Mailer {
    private static final Logger log = LoggerFactory.getLogger(Mailer.class);
    private final JavaMailSenderImpl sender;
    private final String from;
    private final String publicUrl;
    private final ExecutorService pool = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "mailer"); t.setDaemon(true); return t; });

    public Mailer(AiSettings settings) {
        String host = settings.get("SMTP_HOST");
        from = settings.get("SMTP_FROM", "Zynckle <no-reply@zynckle.local>");
        publicUrl = settings.publicUrl().replaceAll("/$", "");
        if (host.isBlank()) { sender = null; return; }
        sender = new JavaMailSenderImpl();
        sender.setHost(host);
        sender.setPort(settings.getInt("SMTP_PORT", 587));
        sender.setUsername(settings.get("SMTP_USERNAME", null));
        sender.setPassword(settings.get("SMTP_PASSWORD", null));
        Properties props = sender.getJavaMailProperties();
        props.put("mail.smtp.auth", String.valueOf(!settings.get("SMTP_USERNAME").isBlank()));
        props.put("mail.smtp.starttls.enable", String.valueOf(!"false".equalsIgnoreCase(settings.get("SMTP_STARTTLS", "true"))));
        props.put("mail.smtp.connectiontimeout", "10000");
        props.put("mail.smtp.timeout", "15000");
    }

    public boolean configured() { return sender != null; }

    /** Absolute link for emails: app paths are relative to the public URL. */
    public String link(String path) { return path.startsWith("http") ? path : publicUrl + path; }

    /** Queue a plain-text email; returns whether it will actually be sent. */
    public boolean send(String to, String subject, String body) {
        if (sender == null || to == null || to.isBlank()) return false;
        pool.submit(() -> {
            try {
                SimpleMailMessage message = new SimpleMailMessage();
                message.setFrom(from);
                message.setTo(to);
                message.setSubject(subject);
                message.setText(body + "\n\n— Zynckle");
                sender.send(message);
            } catch (Exception e) {
                log.warn("Email to {} failed: {}", to, e.getMessage());
            }
        });
        return true;
    }
}
