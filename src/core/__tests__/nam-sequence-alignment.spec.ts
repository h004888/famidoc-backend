import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
// Tài liệu sequence là yêu cầu giao nộp: kiểm tra bằng cú pháp TypeScript, không đoán tên hàm.
const root = path.resolve(__dirname, '../../..');
const document = fs.readFileSync(
  path.join(root, 'docs/nam-api-sequence-map.md'),
  'utf8',
);
const methods = new Map<string, ts.MethodDeclaration>();
const standalone = new Set<string>();
const routes = new Map<string, string[]>();
function values(node: ts.Expression | undefined): string[] {
  if (!node) return [''];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node))
    return node.elements.flatMap((value) =>
      ts.isStringLiteralLike(value) ? [value.text] : [],
    );
  return [];
}
function decorators(node: ts.Node) {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}
function scan(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(file);
      continue;
    }
    if (!file.endsWith('.ts')) continue;
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node) {
      if (ts.isClassDeclaration(node) && node.name) {
        let prefix = '';
        for (const decorator of decorators(node)) {
          const call = decorator.expression;
          if (
            ts.isCallExpression(call) &&
            call.expression.getText(source) === 'Controller'
          )
            prefix = values(call.arguments[0])[0] ?? '';
        }
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member) || !member.name) continue;
          const name = node.name.text + '.' + member.name.getText(source);
          methods.set(name, member);
          for (const decorator of decorators(member)) {
            const call = decorator.expression;
            if (!ts.isCallExpression(call)) continue;
            const verb = call.expression.getText(source);
            if (!['Get', 'Post', 'Put', 'Patch', 'Delete'].includes(verb))
              continue;
            routes.set(
              name,
              values(call.arguments[0]).map(
                (suffix) =>
                  verb.toUpperCase() +
                  ' /' +
                  [prefix, suffix]
                    .filter(Boolean)
                    .join('/')
                    .replace(/^\/+|\/+$/g, '')
                    .replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
              ),
            );
          }
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name)
        standalone.add(node.name.text);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
scan(path.join(root, 'src'));
const apis = document
  .split('\n')
  .filter((line) => /^\|\s*(4[1-9]|5[0-6])\s*\|/.test(line))
  .map((line) =>
    line.split('|').map((value) => value.trim().replace(/^`|`$/g, '')),
  );
describe('Nam API/sequence documentation matches actual code', () => {
  it('contains exactly the 16 assigned APIs', () =>
    expect(apis).toHaveLength(16));
  it.each(apis.map((c) => [c[1], c[3], c[4], c[5]]))(
    '%s: %s exists and controller calls the documented service method',
    (_id, route, controller, service) => {
      expect(routes.get(controller)).toContain(route);
      expect(methods.has(service)).toBe(true);
      const method = controller.split('.')[1];
      expect(methods.get(controller)?.body?.getText()).toMatch(
        new RegExp('this\\.service\\.' + method + '\\s*\\('),
      );
    },
  );
  it('every named class method in the sequence guide exists in production source', () => {
    const names = [...document.matchAll(/`([A-Z]\w+\.\w+)`/g)].map((m) => m[1]);
    const missing = [...new Set(names)].filter((name) => !methods.has(name));
    expect(missing).toEqual([]);
  });
  it('important standalone helpers referenced in the guide exist', () => {
    for (const name of [
      'serializable',
      'writeBusinessAudit',
      'notifyContractParties',
      'calculateContractTermsHash',
      'activateAddendumRights',
      'calculateRevenueShares',
      'calculateMemberAddendum',
    ])
      expect(standalone.has(name)).toBe(true);
  });
});
