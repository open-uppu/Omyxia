import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { MailService } from './mail.service';

interface SendDto {
  to: string | string[];
  subject: string;
  body: string;
  templateId?: string;
  templateVars?: Record<string, unknown>;
}

interface TemplateDto {
  id: string;
  subject: string;
  body: string;
}

@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Get('templates')
  listTemplates(@Req() req: any) {
    if (!req.user?.sub) throw new ForbiddenException('Unauthenticated');
    return this.mailService.listTemplates();
  }

  @Post('templates')
  upsertTemplate(@Req() req: any, @Body() body: TemplateDto) {
    if (!req.user?.sub) throw new ForbiddenException('Unauthenticated');
    if (!body?.id || !body?.subject || !body?.body) {
      throw new BadRequestException('id, subject, body required');
    }
    return this.mailService.upsertTemplate(body);
  }

  @Get('templates/:id')
  getTemplate(@Req() req: any, @Param('id') id: string) {
    if (!req.user?.sub) throw new ForbiddenException('Unauthenticated');
    const t = this.mailService.getTemplate(id);
    if (!t) throw new BadRequestException(`Template ${id} not found`);
    return t;
  }

  @Post('send')
  send(@Req() req: any, @Body() body: SendDto) {
    if (!req.user?.sub) throw new ForbiddenException('Unauthenticated');
    if (!body?.to || !body?.subject || (!body?.body && !body?.templateId)) {
      throw new BadRequestException('to, subject, and (body or templateId) required');
    }
    return this.mailService.send({
      to: body.to,
      subject: body.subject,
      body: body.body,
      templateId: body.templateId,
      templateVars: body.templateVars,
    });
  }
}
