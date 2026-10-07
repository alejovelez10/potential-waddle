import { cleanList, truncate } from './text.utils';

/**
 * Menu JSON comes from two extraction engines:
 *  - Anthropic (default): { categories: [{ category_name, products: [{ product_name, product_description }], subcategories }] }
 *  - Kmizen (legacy):     { categories: [{ category_name, items: [{ name, price }] }] }
 * Both are flattened recursively into dish lines ("Trucha al ajillo — en salsa de ajo…") and
 * section names ("Platos fuertes"), which is what makes "pescado" / "trucha" searchable.
 */
interface MenuNode {
  category_name?: string;
  name?: string;
  products?: MenuProduct[];
  items?: MenuProduct[];
  subcategories?: MenuNode[];
}

interface MenuProduct {
  product_name?: string;
  product_description?: string;
  name?: string;
  description?: string;
}

const DISH_DESCRIPTION_MAX = 90;

export function flattenMenu(data: unknown): { dishes: string[]; sections: string[] } {
  const dishes: string[] = [];
  const sections: string[] = [];

  const visit = (nodes: unknown, depth: number) => {
    if (!Array.isArray(nodes) || depth > 6) return;
    for (const node of nodes as MenuNode[]) {
      if (!node || typeof node !== 'object') continue;
      const section = node.category_name ?? node.name;
      if (section) sections.push(section);
      for (const product of [...(node.products ?? []), ...(node.items ?? [])]) {
        const name = product?.product_name ?? product?.name;
        if (!name) continue;
        const description = product.product_description ?? product.description;
        dishes.push(description ? `${name} — ${truncate(description, DISH_DESCRIPTION_MAX)}` : name);
      }
      visit(node.subcategories, depth + 1);
    }
  };

  const root = data as { categories?: unknown } | null;
  visit(root?.categories, 0);

  return { dishes: cleanList(dishes), sections: cleanList(sections) };
}
