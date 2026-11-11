import { OpenAPIObject } from '@nestjs/swagger';
import { transformOpenApiWithEnvelope } from '../swagger-envelope.transformer';

describe('Swagger Envelope Transformer (OpenAPI Auto-Enveloping)', () => {
  it('nên tự động bọc response 200/201 của route thông thường vào Unified Envelope schema', () => {
    const rawDoc: OpenAPIObject = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0' },
      paths: {
        '/api/v1/doctors/{id}': {
          get: {
            summary: 'Lấy thông tin bác sĩ theo ID',
            responses: {
              '200': {
                description: 'Thành công',
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/DoctorResponseDto',
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const transformed = transformOpenApiWithEnvelope(rawDoc);
    const op = transformed.paths['/api/v1/doctors/{id}']?.get;
    const res200Schema = op?.responses?.['200']?.content?.['application/json']?.schema;

    expect(res200Schema).toBeDefined();
    expect(res200Schema.type).toBe('object');
    expect(res200Schema.required).toEqual(
      expect.arrayContaining(['success', 'code', 'data', 'timestamp', 'requestId']),
    );
    expect(res200Schema.properties.success).toMatchObject({ type: 'boolean', example: true });
    expect(res200Schema.properties.code).toMatchObject({ type: 'number', example: 200 });
    expect(res200Schema.properties.data).toEqual({
      $ref: '#/components/schemas/DoctorResponseDto',
    });
    expect(res200Schema.properties.requestId).toBeDefined();
    expect(res200Schema.properties.timestamp).toBeDefined();
  });

  it('nên bổ sung schema pagination meta cho các route danh sách/phân trang', () => {
    const rawDoc: OpenAPIObject = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0' },
      paths: {
        '/api/v1/care-packages': {
          get: {
            summary: 'Lấy danh sách các gói chăm sóc sức khỏe',
            responses: {
              '200': {
                description: 'Danh sách gói',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/CarePackageListItemDto' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const transformed = transformOpenApiWithEnvelope(rawDoc);
    const op = transformed.paths['/api/v1/care-packages']?.get;
    const res200Schema = op?.responses?.['200']?.content?.['application/json']?.schema;

    expect(res200Schema.properties.meta).toBeDefined();
    expect(res200Schema.properties.meta.properties.pagination).toBeDefined();
    expect(res200Schema.properties.meta.properties.pagination.properties.page).toBeDefined();
    expect(res200Schema.properties.meta.properties.pagination.properties.pageSize).toBeDefined();
    expect(res200Schema.properties.meta.properties.pagination.properties.totalRecords).toBeDefined();
  });

  it('nên bỏ qua không bọc envelope cho các route webhook hoặc có x-bypass-transform', () => {
    const rawDoc: OpenAPIObject = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0' },
      paths: {
        '/api/v1/payments/webhook/vietqr': {
          post: {
            summary: 'IPN Webhook',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { success: { type: 'boolean' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const transformed = transformOpenApiWithEnvelope(rawDoc);
    const op = transformed.paths['/api/v1/payments/webhook/vietqr']?.post;
    const res200Schema = op?.responses?.['200']?.content?.['application/json']?.schema;

    expect(res200Schema.properties.requestId).toBeUndefined();
    expect(res200Schema.properties.data).toBeUndefined();
    expect(res200Schema.properties.success).toBeDefined();
  });

  it('không nên bọc lồng lần 2 nếu route đã có sẵn schema envelope chuẩn', () => {
    const rawDoc: OpenAPIObject = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0' },
      paths: {
        '/api/v1/auth/login': {
          post: {
            summary: 'Đăng nhập',
            responses: {
              '200': {
                description: 'Đăng nhập thành công',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean', example: true },
                        code: { type: 'number', example: 200 },
                        message: { type: 'string' },
                        data: { $ref: '#/components/schemas/LoginDataDto' },
                        timestamp: { type: 'string' },
                        requestId: { type: 'string' },
                      },
                      required: ['success', 'code', 'data', 'timestamp', 'requestId'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const transformed = transformOpenApiWithEnvelope(rawDoc);
    const op = transformed.paths['/api/v1/auth/login']?.post;
    const res200Schema = op?.responses?.['200']?.content?.['application/json']?.schema;

    expect(res200Schema.properties.data).toEqual({
      $ref: '#/components/schemas/LoginDataDto',
    });
  });
});
