import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('App')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Kiểm tra trạng thái máy chủ ứng dụng' })
  @ApiResponse({ status: 200, description: 'Trả về chuỗi chào mừng Hello World' })
  getHello(): string {
    return this.appService.getHello();
  }
}
