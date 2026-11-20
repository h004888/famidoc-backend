import { ApiStandardResponse } from '../api-standard-response.decorator';

class SampleDto {
  id!: string;
  name!: string;
}

class TestController {
  @ApiStandardResponse({
    type: SampleDto,
    status: 200,
    description: 'Chi tiết người dùng',
  })
  getSample() {}

  @ApiStandardResponse({
    type: SampleDto,
    isPaginated: true,
    status: 200,
    description: 'Danh sách người dùng phân trang',
  })
  listSample() {}
}

describe('ApiStandardResponse Decorator', () => {
  it('nên áp dụng Swagger ApiResponse metadata lên controller handler cho single resource', () => {
    const metadata = Reflect.getMetadata(
      'swagger/apiResponse',
      TestController.prototype.getSample,
    );
    expect(metadata).toBeDefined();
    expect(metadata['200']).toBeDefined();
    expect(metadata['200'].description).toBe('Chi tiết người dùng');
    expect(metadata['200'].schema).toBeDefined();
    expect(metadata['200'].schema.properties.success).toBeDefined();
    expect(metadata['200'].schema.properties.data).toBeDefined();
  });

  it('nên áp dụng metadata có chứa pagination schema khi isPaginated: true', () => {
    const metadata = Reflect.getMetadata(
      'swagger/apiResponse',
      TestController.prototype.listSample,
    );
    expect(metadata).toBeDefined();
    expect(metadata['200']).toBeDefined();
    expect(metadata['200'].description).toBe('Danh sách người dùng phân trang');
    expect(metadata['200'].schema.properties.meta).toBeDefined();
  });
});
