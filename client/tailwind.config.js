/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        "2xs": "0 1px 2px rgba(31, 36, 43, 0.05)",
      },
      // 设计约束:一个主色 + 中性灰阶。四类事项用同一色相的深浅梯度区分。
      colors: {
        ink: {
          DEFAULT: "#1f242b",
          2: "#4a525c",
          muted: "#79818c",
        },
        line: {
          DEFAULT: "#e6e9ed",
          soft: "#f0f2f5",
        },
        surface: {
          DEFAULT: "#ffffff",
          2: "#fafbfc",
        },
        canvas: "#f6f8fa",
        accent: {
          DEFAULT: "#24557f",
          hover: "#1b4162",
          tint: "#eef3f8",
        },
        // 类型梯度(同一色相由深到浅)
        t1: "#24557f",
        t2: "#45739c",
        t3: "#6e97b8",
        t4: "#9dbad2",
        // 逾期警示色(仅用于待办「预计完成」的逾期/今日态;不参与 t1-t4 类别梯度)
        danger: {
          DEFAULT: "#c0392b",
          hover: "#a93226",
          tint: "#fdf0ee",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "Source Han Sans SC",
          "sans-serif",
        ],
      },
      borderRadius: {
        card: "8px",
      },
      fontSize: {
        base: ["15px", "1.7"],
      },
    },
  },
  plugins: [],
};