// Helper functions for email templates
function renderTemplate(template, vars = {}) {
  if (!template) return '';
  let result = String(template);
  Object.keys(vars).forEach((key) => {
    const val = vars[key] !== undefined && vars[key] !== null ? vars[key] : '';
    const patternBraces = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    const patternDollar = new RegExp(`\\$\\{\\s*${key}\\s*\\}`, 'g');
    result = result.replace(patternBraces, val).replace(patternDollar, val);
  });
  return result;
}

function formatSessionDate(sessionDate) {
  if (!sessionDate) return 'To be scheduled';
  try {
    const date = new Date(sessionDate);
    return date.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC'
    });
  } catch (e) {
    return 'To be scheduled';
  }
}

function generateHealerEmail(data) {
  const sessionDateTime = formatSessionDate(data.sessionDate);
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #01A3B4;">🎉 New Booking Confirmed!</h2>
      <p>Hi ${data.healerName},</p>
      <p>Great news! You have a new booking for <strong>"${data.listingTitle}"</strong>.</p>

      <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #01A3B4;">
        <h3 style="margin-top: 0; color: #01A3B4;">📋 Booking Details:</h3>
        <ul style="list-style: none; padding: 0;">
          <li style="margin: 10px 0;"><strong>Booking ID:</strong> ${data.bookingId}</li>
          <li style="margin: 10px 0;"><strong>Amount:</strong> <span style="color: #10b981; font-weight: bold;">$${data.amount}</span></li>
          <li style="margin: 10px 0;"><strong>Seeker:</strong> ${data.seekerName}</li>
          <li style="margin: 10px 0;"><strong>Seeker Email:</strong> ${data.seekerEmail}</li>
          <li style="margin: 10px 0;"><strong>Session Date & Time:</strong> ${sessionDateTime}</li>
          <li style="margin: 10px 0;"><strong>Session Length:</strong> ${data.sessionLength}</li>
          <li style="margin: 10px 0;"><strong>Format:</strong> ${data.format}</li>
          <li style="margin: 10px 0;"><strong>Modality:</strong> ${data.modality}</li>
        </ul>
      </div>

      <p style="background: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b;">
        <strong>⚠️ Action Required:</strong> Please log in to your dashboard to confirm this booking and prepare for the session.
      </p>

      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
        <p style="color: #666; font-size: 12px;">
          This is an automated message from Ultra Healers. Please do not reply to this email.
        </p>
      </div>
    </div>
  `;
}

function generateSeekerEmail(data) {
  const sessionDateTime = formatSessionDate(data.sessionDate);
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #01A3B4;">✅ Your Booking is Confirmed!</h2>
      <p>Hi ${data.seekerName},</p>
      <p>Thank you for booking with us! Your session with <strong>${data.healerName}</strong> for <strong>"${data.listingTitle}"</strong> has been confirmed.</p>

      <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
        <h3 style="margin-top: 0; color: #059669;">📅 Your Session Details:</h3>
        <ul style="list-style: none; padding: 0;">
          <li style="margin: 10px 0;"><strong>Booking ID:</strong> ${data.bookingId}</li>
          <li style="margin: 10px 0;"><strong>Amount Paid:</strong> <span style="color: #10b981; font-weight: bold;">$${data.amount}</span></li>
          <li style="margin: 10px 0;"><strong>Healer:</strong> ${data.healerName}</li>
          <li style="margin: 10px 0;"><strong>Session Date & Time:</strong> ${sessionDateTime}</li>
          <li style="margin: 10px 0;"><strong>Session Length:</strong> ${data.sessionLength}</li>
          <li style="margin: 10px 0;"><strong>Format:</strong> ${data.format}</li>
          <li style="margin: 10px 0;"><strong>Modality:</strong> ${data.modality}</li>
        </ul>
      </div>

      <p style="background: #dbeafe; padding: 15px; border-radius: 8px; border-left: 4px solid #3b82f6;">
        <strong>ℹ️ Next Steps:</strong> The healer will reach out to you shortly to confirm the session details and provide any necessary instructions or meeting links.
      </p>

      <p style="margin-top: 20px;">
        If you have any questions, please log in to your dashboard or contact our support team.
      </p>

      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
        <p style="color: #666; font-size: 12px;">
          This is an automated message from Ultra Healers. Please do not reply to this email.
        </p>
      </div>
    </div>
  `;
}

function generateWelcomeSeekerEmail(data) {
  const name = data.name || data.seekerName || 'Seeker';
  const email = data.email || '';
  const dashboardUrl = process.env.SEEKER_APP_URL || 'https://ultrahealers.com/dashboard';

  if (data.customBody) {
    const renderedText = renderTemplate(data.customBody, { name, email, dashboardUrl });
    const formattedParagraphs = renderedText
      .split(/\n\s*\n/)
      .map(p => `<p style="color: #4b5563; line-height: 1.6; font-size: 15px; margin-bottom: 16px;">${p.replace(/\n/g, '<br>')}</p>`)
      .join('');

    return `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e5e7eb;">
        <div style="background: linear-gradient(135deg, #01A3B4 0%, #0891b2 100%); padding: 35px 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">Ultra Healers</h1>
          <p style="color: #e0f2fe; margin: 8px 0 0 0; font-size: 15px;">Welcome to Your Wellness Journey</p>
        </div>
        
        <div style="padding: 35px 30px;">
          ${formattedParagraphs}

          <div style="text-align: center; margin: 32px 0;">
            <a href="${dashboardUrl}" 
               style="background: #01A3B4; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 15px; box-shadow: 0 2px 8px rgba(1, 163, 180, 0.3);">
              Explore Healers & Services
            </a>
          </div>
        </div>

        <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            © ${new Date().getFullYear()} Ultra Healers. All rights reserved.<br>
            This is an automated message. Please do not reply directly to this email.
          </p>
        </div>
      </div>
    `;
  }

  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e5e7eb;">
      <div style="background: linear-gradient(135deg, #01A3B4 0%, #0891b2 100%); padding: 35px 20px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">Ultra Healers</h1>
        <p style="color: #e0f2fe; margin: 8px 0 0 0; font-size: 15px;">Welcome to Your Wellness Journey</p>
      </div>
      
      <div style="padding: 35px 30px;">
        <h2 style="color: #1f2937; margin: 0 0 16px 0; font-size: 20px;">Welcome, ${name}!</h2>
        <p style="color: #4b5563; line-height: 1.6; font-size: 15px; margin-bottom: 24px;">
          Thank you for joining <strong>Ultra Healers</strong>. We are thrilled to have you in our community of seekers dedicated to personal growth, healing, and holistic well-being.
        </p>

        <div style="background: #f0fdfa; padding: 22px; border-radius: 10px; margin-bottom: 28px; border-left: 4px solid #01A3B4;">
          <h3 style="margin-top: 0; color: #0d9488; font-size: 16px; font-weight: 600;">Here is what you can do right away:</h3>
          <ul style="padding-left: 20px; margin: 10px 0 0 0; color: #374151; font-size: 14px; line-height: 1.8;">
            <li><strong>Discover Practitioners:</strong> Browse verified healers specializing in reiki, meditation, sound therapy, and more.</li>
            <li><strong>Book 1-on-1 Sessions:</strong> Schedule online or in-person appointments at times that suit you.</li>
            <li><strong>Explore Retreats:</strong> Find transformative wellness retreats tailored to your goals.</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${dashboardUrl}" 
             style="background: #01A3B4; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 15px; box-shadow: 0 2px 8px rgba(1, 163, 180, 0.3);">
            Explore Healers & Services
          </a>
        </div>

        <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin-top: 25px;">
          If you have any questions or need recommendations, our support team is always here to guide you.
        </p>
      </div>

      <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
          © ${new Date().getFullYear()} Ultra Healers. All rights reserved.<br>
          This is an automated message. Please do not reply directly to this email.
        </p>
      </div>
    </div>
  `;
}

function generateWelcomeHealerEmail(data) {
  const name = data.name || data.healerName || 'Practitioner';
  const email = data.email || '';
  const dashboardUrl = process.env.HEALER_APP_URL || 'https://ultrahealers.com/healer/dashboard';

  if (data.customBody) {
    const renderedText = renderTemplate(data.customBody, { name, email, dashboardUrl });
    const formattedParagraphs = renderedText
      .split(/\n\s*\n/)
      .map(p => `<p style="color: #4b5563; line-height: 1.6; font-size: 15px; margin-bottom: 16px;">${p.replace(/\n/g, '<br>')}</p>`)
      .join('');

    return `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e5e7eb;">
        <div style="background: linear-gradient(135deg, #01A3B4 0%, #0891b2 100%); padding: 35px 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">Ultra Healers</h1>
          <p style="color: #e0f2fe; margin: 8px 0 0 0; font-size: 15px;">Welcome to Our Practitioner Community</p>
        </div>
        
        <div style="padding: 35px 30px;">
          ${formattedParagraphs}

          <div style="text-align: center; margin: 32px 0;">
            <a href="${dashboardUrl}" 
               style="background: #01A3B4; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 15px; box-shadow: 0 2px 8px rgba(1, 163, 180, 0.3);">
              Set Up Your Practitioner Profile
            </a>
          </div>
        </div>

        <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            © ${new Date().getFullYear()} Ultra Healers. All rights reserved.<br>
            This is an automated message. Please do not reply directly to this email.
          </p>
        </div>
      </div>
    `;
  }

  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e5e7eb;">
      <div style="background: linear-gradient(135deg, #01A3B4 0%, #0891b2 100%); padding: 35px 20px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">Ultra Healers</h1>
        <p style="color: #e0f2fe; margin: 8px 0 0 0; font-size: 15px;">Welcome to Our Practitioner Community</p>
      </div>
      
      <div style="padding: 35px 30px;">
        <h2 style="color: #1f2937; margin: 0 0 16px 0; font-size: 20px;">Welcome, ${name}!</h2>
        <p style="color: #4b5563; line-height: 1.6; font-size: 15px; margin-bottom: 24px;">
          We are honored to welcome you as a practitioner on <strong>Ultra Healers</strong>. Our platform connects dedicated healers like you with seekers looking for guidance, transformation, and holistic care.
        </p>

        <div style="background: #f0fdfa; padding: 22px; border-radius: 10px; margin-bottom: 28px; border-left: 4px solid #01A3B4;">
          <h3 style="margin-top: 0; color: #0d9488; font-size: 16px; font-weight: 600;">Steps to get your practice ready:</h3>
          <ol style="padding-left: 20px; margin: 10px 0 0 0; color: #374151; font-size: 14px; line-height: 1.8;">
            <li><strong>Complete Your Profile:</strong> Add your biography, certifications, and profile picture.</li>
            <li><strong>Create Service Listings:</strong> Publish your offerings, modalities, pricing, and available session formats.</li>
            <li><strong>Connect Payouts:</strong> Set up your payout details to receive earnings.</li>
          </ol>
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${dashboardUrl}" 
             style="background: #01A3B4; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 15px; box-shadow: 0 2px 8px rgba(1, 163, 180, 0.3);">
            Set Up Your Practitioner Profile
          </a>
        </div>

        <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin-top: 25px;">
          Need help setting up your profile or services? Reach out to our practitioner support team anytime.
        </p>
      </div>

      <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
          © ${new Date().getFullYear()} Ultra Healers. All rights reserved.<br>
          This is an automated message. Please do not reply directly to this email.
        </p>
      </div>
    </div>
  `;
}

function generateHealerText(data) {
  const sessionDateTime = formatSessionDate(data.sessionDate);
  return `Hi ${data.healerName},

You have a new booking confirmed for "${data.listingTitle}".

Booking Details:
- Booking ID: ${data.bookingId}
- Amount: $${data.amount}
- Seeker: ${data.seekerName} (${data.seekerEmail})
- Session Date & Time: ${sessionDateTime}
- Session Length: ${data.sessionLength}
- Format: ${data.format}
- Modality: ${data.modality}

Please log in to your dashboard to confirm this booking and prepare for the session.

Ultra Healers Team
https://ultrahealers.com`;
}

function generateSeekerText(data) {
  const sessionDateTime = formatSessionDate(data.sessionDate);
  return `Hi ${data.seekerName},

Your booking for "${data.listingTitle}" with ${data.healerName} is confirmed!

Your Session Details:
- Booking ID: ${data.bookingId}
- Amount Paid: $${data.amount}
- Healer: ${data.healerName}
- Session Date & Time: ${sessionDateTime}
- Session Length: ${data.sessionLength}
- Format: ${data.format}
- Modality: ${data.modality}

The healer will reach out to you shortly to confirm the session details and provide any necessary instructions or meeting links.

Ultra Healers Team
https://ultrahealers.com`;
}

function generateWelcomeSeekerText(data) {
  const name = data.name || data.seekerName || 'Seeker';
  const email = data.email || '';
  const dashboardUrl = process.env.SEEKER_APP_URL || 'https://ultrahealers.com/dashboard';

  if (data.customBody) {
    return renderTemplate(data.customBody, { name, email, dashboardUrl });
  }

  return `Hi ${name},

Welcome to Ultra Healers! Thank you for joining our community.

You can browse healers, book 1-on-1 sessions, and explore wellness retreats directly from your dashboard:
${dashboardUrl}

If you have any questions, feel free to reply directly to this email.

Best regards,
Ultra Healers Team
https://ultrahealers.com`;
}

function generateWelcomeHealerText(data) {
  const name = data.name || data.healerName || 'Practitioner';
  const email = data.email || '';
  const dashboardUrl = process.env.HEALER_APP_URL || 'https://ultrahealers.com/healer/dashboard';

  if (data.customBody) {
    return renderTemplate(data.customBody, { name, email, dashboardUrl });
  }

  return `Hi ${name},

Welcome to Ultra Healers! We are glad to have you as a practitioner on our platform.

To get started, please visit your dashboard to complete your practitioner profile and set up your service listings:
${dashboardUrl}

If you need any assistance, feel free to reply directly to this email.

Best regards,
Ultra Healers Team
https://ultrahealers.com`;
}

function generateAdminSignupNotificationEmail(data) {
  const name = data.name || 'N/A';
  const email = data.email || 'N/A';
  const role = (data.role || 'seeker').toUpperCase();
  const userId = data.userId || data.id || 'N/A';
  const registeredAt = data.createdAt ? new Date(data.createdAt).toLocaleString() : new Date().toLocaleString();
  const roleBadgeColor = role === 'HEALER' ? '#0d9488' : '#0284c7';
  const roleBgColor = role === 'HEALER' ? '#f0fdfa' : '#f0f9ff';

  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e5e7eb;">
      <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 30px 20px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">Ultra Healers Admin Alert</h1>
        <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 14px;">New User Registration Notification</p>
      </div>
      
      <div style="padding: 30px;">
        <div style="background: ${roleBgColor}; border-left: 4px solid ${roleBadgeColor}; padding: 16px 20px; border-radius: 8px; margin-bottom: 24px;">
          <span style="background: ${roleBadgeColor}; color: #ffffff; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 700; text-transform: uppercase;">
            ${role} SIGNUP
          </span>
          <h2 style="color: #0f172a; margin: 10px 0 4px 0; font-size: 18px;">A new ${role.toLowerCase()} has registered on the platform!</h2>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600; width: 120px;">Full Name:</td>
            <td style="padding: 10px 0; color: #0f172a; font-weight: 500;">${name}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Email Address:</td>
            <td style="padding: 10px 0; color: #0f172a; font-weight: 500;"><a href="mailto:${email}" style="color: #01A3B4; text-decoration: none;">${email}</a></td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">User Role:</td>
            <td style="padding: 10px 0; color: #0f172a; font-weight: 500;">${role}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">User ID:</td>
            <td style="padding: 10px 0; color: #475569; font-family: monospace;">${userId}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Time:</td>
            <td style="padding: 10px 0; color: #0f172a;">${registeredAt}</td>
          </tr>
        </table>

        <p style="color: #64748b; font-size: 13px; margin-top: 20px;">
          This is an automated notification from the Ultra Healers platform backend.
        </p>
      </div>

      <div style="background-color: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">
          © ${new Date().getFullYear()} Ultra Healers System Admin
        </p>
      </div>
    </div>
  `;
}

function generateAdminSignupNotificationText(data) {
  const name = data.name || 'N/A';
  const email = data.email || 'N/A';
  const role = (data.role || 'seeker').toUpperCase();
  const userId = data.userId || data.id || 'N/A';
  const registeredAt = data.createdAt ? new Date(data.createdAt).toLocaleString() : new Date().toLocaleString();

  return `[ADMIN ALERT] New ${role} Registration

A new user has registered on Ultra Healers.

User Details:
- Name: ${name}
- Email: ${email}
- Role: ${role}
- User ID: ${userId}
- Time: ${registeredAt}

Ultra Healers Platform System Notification`;
}

module.exports = {
  renderTemplate,
  generateHealerEmail,
  generateHealerText,
  generateSeekerEmail,
  generateSeekerText,
  generateWelcomeSeekerEmail,
  generateWelcomeSeekerText,
  generateWelcomeHealerEmail,
  generateWelcomeHealerText,
  generateAdminSignupNotificationEmail,
  generateAdminSignupNotificationText
};


