// Helper functions for email templates
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

module.exports = {
  generateHealerEmail,
  generateSeekerEmail
};
