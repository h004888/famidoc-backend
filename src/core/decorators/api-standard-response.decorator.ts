import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

export interface ApiStandardResponseOptions {
  type?: Type<any> | Function | [Function] | string;
  status?: number;
  description?: string;
  isPaginated?: boolean;
}

export function ApiStandardResponse(options: ApiStandardResponseOptions = {}) {
  const status = options.status ?? 200;
  const description = options.description ?? 'Phản hồi thành công';
  const decorators: Array<ClassDecorator | MethodDecorator | PropertyDecorator> = [];

  let dataPropertySchema: Record<string, any> = {
    type: 'object',
    nullable: true,
  };

  if (options.type && typeof options.type === 'function') {
    decorators.push(ApiExtraModels(options.type as Type<any>));
    if (options.isPaginated) {
      dataPropertySchema = {
        type: 'array',
        items: { $ref: getSchemaPath(options.type as Type<any>) },
      };
    } else {
      dataPropertySchema = {
        $ref: getSchemaPath(options.type as Type<any>),
      };
    }
  } else if (typeof options.type === 'string') {
    dataPropertySchema = {
      type: options.type,
      example: options.type === 'string' ? 'sample text' : undefined,
    };
  }


  let metaPropertySchema: Record<string, any> = {
    type: 'object',
    nullable: true,
  };

  if (options.isPaginated) {
    metaPropertySchema = {
      type: 'object',
      properties: {
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'number', example: 1 },
            pageSize: { type: 'number', example: 20 },
            totalRecords: { type: 'number', example: 100 },
            totalPages: { type: 'number', example: 5 },
            hasNextPage: { type: 'boolean', example: true },
            hasPreviousPage: { type: 'boolean', example: false },
            nextCursor: { type: 'string', nullable: true },
            previousCursor: { type: 'string', nullable: true },
          },
        },
      },
    };
  }

  const envelopeSchema = {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      code: { type: 'number', example: status },
      message: { type: 'string', example: description },
      data: dataPropertySchema,
      meta: metaPropertySchema,
      timestamp: {
        type: 'string',
        format: 'date-time',
        example: '2026-11-10T08:30:00.000Z',
      },
      requestId: {
        type: 'string',
        example: 'req_01HV8Z7B3C4D5E6F7G8H9J0K1L',
      },
    },
    required: ['success', 'code', 'data', 'timestamp', 'requestId'],
  };

  decorators.push(
    ApiResponse({
      status,
      description,
      schema: envelopeSchema,
    }),
  );

  return applyDecorators(...decorators);
}
