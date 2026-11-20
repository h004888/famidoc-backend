import { OpenAPIObject } from '@nestjs/swagger';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

export function transformOpenApiWithEnvelope(document: OpenAPIObject): OpenAPIObject {
  if (!document || !document.paths) {
    return document;
  }

  const newPaths: Record<string, any> = {};

  for (const [routePath, pathItem] of Object.entries(document.paths)) {
    if (!pathItem || typeof pathItem !== 'object') {
      newPaths[routePath] = pathItem;
      continue;
    }

    const lowerPath = routePath.toLowerCase();
    const isWebhook =
      lowerPath.includes('/webhook/') ||
      lowerPath.includes('/webhooks/') ||
      lowerPath.startsWith('webhooks/') ||
      lowerPath.startsWith('webhook/');

    const newPathItem: Record<string, any> = { ...pathItem };

    for (const method of HTTP_METHODS) {
      const operation = (pathItem as any)[method];
      if (!operation || typeof operation !== 'object') continue;

      const isBypass = (operation as any)['x-bypass-transform'] === true || isWebhook;
      if (isBypass) continue;

      const responses = operation.responses;
      if (!responses || typeof responses !== 'object') continue;

      // Wrap 200 or 201 responses
      for (const statusCode of ['200', '201']) {
        const resObj = responses[statusCode];
        if (!resObj || typeof resObj !== 'object') continue;

        const jsonContent = resObj.content?.['application/json'];
        if (!jsonContent) continue;

        const originalSchema = jsonContent.schema;
        if (!originalSchema || typeof originalSchema !== 'object') continue;

        // Check idempotency: if already wrapped in Unified Envelope
        if (
          originalSchema.properties &&
          originalSchema.properties.success &&
          originalSchema.properties.code &&
          originalSchema.properties.data &&
          originalSchema.properties.requestId
        ) {
          continue;
        }

        const summaryLower = (operation.summary || '').toLowerCase();
        const isPaginated =
          summaryLower.includes('danh sách') ||
          summaryLower.includes('phân trang') ||
          lowerPath.endsWith('/list') ||
          lowerPath.includes('/list/') ||
          originalSchema.type === 'array' ||
          Boolean(originalSchema.items);

        let dataSchema = originalSchema;
        let metaSchema: Record<string, any> = {
          type: 'object',
          nullable: true,
        };

        if (isPaginated) {
          metaSchema = {
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

        const statusCodeNum = parseInt(statusCode, 10);
        const envelopeSchema = {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            code: { type: 'number', example: statusCodeNum },
            message: { type: 'string', example: resObj.description || 'Thành công' },
            data: dataSchema,
            meta: metaSchema,
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2026-11-11T08:30:00.000Z',
            },
            requestId: {
              type: 'string',
              example: 'req_01HV8Z7B3C4D5E6F7G8H9J0K1L',
            },
          },
          required: ['success', 'code', 'data', 'timestamp', 'requestId'],
        };

        resObj.content['application/json'].schema = envelopeSchema;
      }
    }

    newPaths[routePath] = newPathItem;
  }

  return {
    ...document,
    paths: newPaths,
  };
}
