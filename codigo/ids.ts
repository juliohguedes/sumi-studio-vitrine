// Números de identificação (traços, camadas, quadros, balões, réguas, capítulos).
// No desenho compartilhado, várias pessoas criam coisas ao mesmo tempo: se cada uma contasse
// 1, 2, 3..., dois balões diferentes teriam o mesmo número. Por isso cada vez que o programa
// abre ele sorteia uma "faixa" própria de números (mais de um milhão de faixas possíveis) e
// conta dentro dela. Os números ficam abaixo de 2^53, o limite exato do JavaScript.

const BASE = (Math.floor(Math.random() * 2 ** 20) + 1) * 2 ** 32;
let counter = 0;

export function newId(): number {
  return BASE + ++counter;
}
