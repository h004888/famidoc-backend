import { registerDecorator, ValidateIf } from 'class-validator';

export function FieldFor(
  selector: string,
  values: readonly string[],
  required = true,
): PropertyDecorator {
  return (target, property) => {
    const propertyName = String(property);
    const applies = (dto: object) =>
      values.some((value) => value === Reflect.get(dto, selector));

    // Trường đúng nhánh phải được kiểm tra kể cả khi thiếu. Trường sai nhánh
    // chỉ được bỏ qua khi client thực sự không gửi, kể cả null cũng bị từ chối.
    ValidateIf(
      (dto, value) => value !== undefined || (required && applies(dto)),
    )(target, property);
    registerDecorator({
      name: 'fieldFor',
      target: target.constructor,
      propertyName,
      validator: {
        validate: (_value, args) => Boolean(args && applies(args.object)),
        defaultMessage: () =>
          `${propertyName} chỉ được gửi khi ${selector} là ${values.join(' hoặc ')}.`,
      },
    });
  };
}
