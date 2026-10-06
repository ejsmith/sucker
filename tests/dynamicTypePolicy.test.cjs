const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

test('game Text elements permit bounded Dynamic Type growth', () => {
  for (const file of ['App.tsx', 'src/ui/PlayerAvatar.tsx', 'src/ui/StatsPage.tsx']) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(path.join(__dirname, '..', file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const constants = new Map();
    const walk = (node, visit) => {
      visit(node);
      ts.forEachChild(node, (child) => walk(child, visit));
    };
    walk(source, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isNumericLiteral(node.initializer)
      ) {
        constants.set(node.name.text, Number(node.initializer.text));
      }
    });
    let textCount = 0;
    walk(source, (node) => {
      if (
        !(ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) ||
        node.tagName.getText(source) !== 'Text'
      )
        return;
      textCount++;
      const attrs = new Map(
        node.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((attr) => [attr.name.getText(source), attr.initializer]),
      );
      const scaling = attrs.get('allowFontScaling');
      assert.ok(
        !scaling || !ts.isJsxExpression(scaling) || scaling.expression?.kind !== ts.SyntaxKind.FalseKeyword,
        file + ' disables font scaling',
      );
      const initializer = attrs.get('maxFontSizeMultiplier');
      assert.ok(initializer && ts.isJsxExpression(initializer) && initializer.expression, file + ' has unbounded Text');
      const expression = initializer.expression;
      const multiplier = ts.isNumericLiteral(expression)
        ? Number(expression.text)
        : constants.get(expression.getText(source));
      assert.ok(multiplier > 1 && multiplier <= 1.2, file + ' must permit bounded growth');
    });
    assert.ok(textCount > 0, file + ' must contain game text');
  }
});
