
# Test Skill
This is a test skill.

## tool:hello
- name: hello
- description: Say hello to someone
- params:
  - name: name (string)

```javascript
export async function run({ name }) {
  return "Hello, " + name + "!";
}
```
