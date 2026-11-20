import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export type SystemOneQuestionType = 'score' | 'noul';

export class UpdateMatchingConfigDto {
  @ApiPropertyOptional({
    description: 'Bật/tắt đánh giá bằng model decision chuẩn System One',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      'URL endpoint chuẩn POST /v1/systemone (ví dụ http://localhost:11434/v1/systemone hoặc https://api.typesafe.ai/v1/systemone)',
    example: 'http://localhost:11434/v1/systemone',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  endpointUrl?: string;

  @ApiPropertyOptional({
    description: 'Tên model decision trên endpoint System One',
    example: 'd3:4b',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  modelName?: string;

  @ApiPropertyOptional({
    description: 'Kiểu câu hỏi gửi tới /v1/systemone',
    enum: ['score', 'noul'],
    example: 'score',
  })
  @IsOptional()
  @IsIn(['score', 'noul'])
  questionType?: SystemOneQuestionType;

  @ApiPropertyOptional({
    description:
      'API Key Bearer (không bắt buộc cho endpoint local như Ollama; để trống nếu không muốn thay đổi)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  apiKey?: string;

  @ApiPropertyOptional({
    description: 'Đặt true để xóa API Key đã lưu và chạy chế độ không xác thực',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean;

  @ApiPropertyOptional({
    description: 'Timeout gọi API System One (ms)',
    example: 25000,
    minimum: 1000,
    maximum: 120000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;

  @ApiPropertyOptional({
    description: 'Số lượng ứng viên tối đa gửi sang model đánh giá mỗi lượt',
    example: 10,
    minimum: 1,
    maximum: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  maxCandidates?: number;

  @ApiPropertyOptional({
    description: 'Ngưỡng điểm phù hợp tối thiểu [0..1] trước khi fallback hàng chờ Admin',
    example: 0.6,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minFitThreshold?: number;

  @ApiPropertyOptional({
    description: 'Trọng số điểm phù hợp model [0..1]',
    example: 0.7,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  fitWeight?: number;

  @ApiPropertyOptional({
    description: 'Trọng số độ trống slot đối tác [0..1]',
    example: 0.3,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  vacancyWeight?: number;
}

export class TestMatchingConfigDto {
  @ApiPropertyOptional({
    description: 'URL endpoint /v1/systemone cần kiểm tra thử (mặc định dùng cấu hình hiện hành)',
    example: 'http://localhost:11434/v1/systemone',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  endpointUrl?: string;

  @ApiPropertyOptional({
    description: 'Tên model cần kiểm tra thử',
    example: 'd3:4b',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  modelName?: string;

  @ApiPropertyOptional({
    enum: ['score', 'noul'],
    example: 'score',
  })
  @IsOptional()
  @IsIn(['score', 'noul'])
  questionType?: SystemOneQuestionType;

  @ApiPropertyOptional({
    description: 'API Key thử nghiệm (tùy chọn)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  apiKey?: string;

  @ApiPropertyOptional({
    description: 'Bỏ qua API Key đã lưu khi test thử kết nối không cần khóa',
  })
  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean;

  @ApiPropertyOptional({
    description: 'Timeout test thử (ms)',
    example: 25000,
    minimum: 1000,
    maximum: 120000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;
}

export class DiscoverSystemOneModelsQueryDto {
  @ApiPropertyOptional({
    description: 'Endpoint URL đang nhập để suy ra origin Ollama (/api/tags)',
    example: 'http://localhost:11434/v1/systemone',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  endpointUrl?: string;
}
