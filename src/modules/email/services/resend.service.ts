import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { EnvironmentVariables } from '../../../config/app-config';
import { getWelcomeEmailTemplate } from '../templates/welcome.template';
import { getResetPasswordTemplate } from '../templates/reset-password.template';
import { getBusinessWelcomeTemplate } from '../templates/business-welcome.template';
import { getLodgingSubmittedTemplate } from '../templates/lodging-submitted.template';
import { getLodgingApprovedTemplate } from '../templates/lodging-approved.template';
import { getLodgingRejectedTemplate } from '../templates/lodging-rejected.template';
import { getAdminLodgingPendingTemplate } from '../templates/admin-lodging-pending.template';
import { getNotificationTemplate, NotificationTemplateParams } from '../templates/notification.template';

@Injectable()
export class ResendService {
  private readonly resend: Resend;
  private readonly fromEmail: string;
  private readonly frontendUrl: string;
  private readonly adminNotificationEmail: string;
  private readonly logger = new Logger(ResendService.name);

  constructor(private readonly configService: ConfigService<EnvironmentVariables>) {
    const resendConfig = this.configService.get('resend', { infer: true });
    const apiKey = resendConfig?.apiKey;
    this.fromEmail = resendConfig?.fromEmail || 'Binntu <noreply@binntu.com>';
    this.adminNotificationEmail = resendConfig?.adminNotificationEmail || '';
    this.frontendUrl = this.configService.get('frontendUrl', { infer: true }) || 'http://localhost:3000';
    this.resend = new Resend(apiKey);
  }

  async sendWelcomeEmail(to: string, username: string): Promise<boolean> {
    try {
      const { html, subject } = getWelcomeEmailTemplate(username);

      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to,
        subject,
        html,
      });

      if (error) {
        this.logger.error(`Failed to send welcome email to ${to}`, error);
        return false;
      }

      this.logger.log(`Welcome email sent to ${to}, id: ${data?.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Error sending welcome email to ${to}`, error);
      return false;
    }
  }

  async sendPasswordResetEmail(to: string, username: string, token: string): Promise<boolean> {
    try {
      const resetUrl = `${this.frontendUrl}/auth/reset-password?token=${token}`;
      const { html, subject } = getResetPasswordTemplate(username, resetUrl);

      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to,
        subject,
        html,
      });

      if (error) {
        this.logger.error(`Failed to send password reset email to ${to}`, error);
        return false;
      }

      this.logger.log(`Password reset email sent to ${to}, id: ${data?.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Error sending password reset email to ${to}`, error);
      return false;
    }
  }

  async sendBusinessWelcomeEmail(to: string, username: string): Promise<boolean> {
    try {
      const wizardUrl = `${this.frontendUrl}/profile/negocios/lodgings/onboarding`;
      const { html, subject } = getBusinessWelcomeTemplate(username, wizardUrl);

      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to,
        subject,
        html,
      });

      if (error) {
        this.logger.error(`Failed to send business welcome email to ${to}`, error);
        return false;
      }

      this.logger.log(`Business welcome email sent to ${to}, id: ${data?.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Error sending business welcome email to ${to}`, error);
      return false;
    }
  }

  async sendLodgingSubmittedEmail(to: string, lodgingName: string): Promise<boolean> {
    try {
      const { html, subject } = getLodgingSubmittedTemplate(lodgingName);

      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to,
        subject,
        html,
      });

      if (error) {
        this.logger.error(`Failed to send lodging submitted email to ${to}`, error);
        return false;
      }

      this.logger.log(`Lodging submitted email sent to ${to}, id: ${data?.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Error sending lodging submitted email to ${to}`, error);
      return false;
    }
  }

  async sendLodgingApprovedEmail(to: string, lodgingName: string, slug: string): Promise<boolean> {
    try {
      const publicUrl = `${this.frontendUrl}/lodgings/${slug}`;
      const { html, subject } = getLodgingApprovedTemplate(lodgingName, publicUrl);

      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to,
        subject,
        html,
      });

      if (error) {
        this.logger.error(`Failed to send lodging approved email to ${to}`, error);
        return false;
      }

      this.logger.log(`Lodging approved email sent to ${to}, id: ${data?.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Error sending lodging approved email to ${to}`, error);
      return false;
    }
  }

  async sendLodgingRejectedEmail(to: string, lodgingName: string, reason: string): Promise<boolean> {
    try {
      const wizardUrl = `${this.frontendUrl}/profile/negocios/lodgings/onboarding`;
      const { html, subject } = getLodgingRejectedTemplate(lodgingName, reason, wizardUrl);

      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to,
        subject,
        html,
      });

      if (error) {
        this.logger.error(`Failed to send lodging rejected email to ${to}`, error);
        return false;
      }

      this.logger.log(`Lodging rejected email sent to ${to}, id: ${data?.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Error sending lodging rejected email to ${to}`, error);
      return false;
    }
  }

  async sendAdminLodgingPendingNotification(lodgingName: string, ownerEmail: string): Promise<boolean> {
    const adminEmail = this.adminNotificationEmail || this.fromEmail;

    if (!this.adminNotificationEmail) {
      this.logger.warn('ADMIN_NOTIFICATION_EMAIL not set — skipping admin pending notification');
      return false;
    }

    try {
      const adminPanelUrl = `${this.frontendUrl}/admin/lodgings/pending`;
      const { html, subject } = getAdminLodgingPendingTemplate(lodgingName, ownerEmail, adminPanelUrl);

      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: adminEmail,
        subject,
        html,
      });

      if (error) {
        this.logger.error(`Failed to send admin lodging pending notification`, error);
        return false;
      }

      this.logger.log(`Admin lodging pending notification sent to ${adminEmail}, id: ${data?.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Error sending admin lodging pending notification`, error);
      return false;
    }
  }

  /**
   * Internal alert to ADMIN_NOTIFICATION_EMAIL (freemium flows: verification requests, Premium
   * assisted onboarding). `path` is appended to FRONTEND_URL for the CTA.
   */
  async sendAdminNotification(
    params: Omit<NotificationTemplateParams, 'eyebrow' | 'ctaUrl'> & { path?: string },
  ): Promise<boolean> {
    if (!this.adminNotificationEmail) {
      this.logger.warn(`ADMIN_NOTIFICATION_EMAIL not set — skipping admin notification "${params.subject}"`);
      return false;
    }
    const { path, ...rest } = params;
    return this.sendNotification(this.adminNotificationEmail, {
      ...rest,
      eyebrow: 'Binntu Admin — Notificación interna',
      ctaUrl: path ? `${this.frontendUrl}${path}` : undefined,
    });
  }

  /** Transactional notice to a business owner (freemium flows). */
  async sendOwnerNotification(
    to: string,
    params: Omit<NotificationTemplateParams, 'eyebrow' | 'ctaUrl'> & { path?: string },
  ): Promise<boolean> {
    const { path, ...rest } = params;
    return this.sendNotification(to, {
      ...rest,
      eyebrow: 'Binntu para negocios',
      ctaUrl: path ? `${this.frontendUrl}${path}` : undefined,
    });
  }

  private async sendNotification(to: string, params: NotificationTemplateParams): Promise<boolean> {
    try {
      const { html, subject } = getNotificationTemplate(params);
      const { data, error } = await this.resend.emails.send({ from: this.fromEmail, to, subject, html });
      if (error) {
        this.logger.error(`Failed to send notification "${params.subject}" to ${to}`, error);
        return false;
      }
      this.logger.log(`Notification "${params.subject}" sent to ${to}, id: ${data?.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Error sending notification "${params.subject}" to ${to}`, error);
      return false;
    }
  }
}
