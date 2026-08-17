module.exports = {
  apps: [
    {
      name: "fpv-relay",
      cwd: "/opt/FPVCarController/server",
      script: "index.js",
      node_args: "--env-file=.env",
      env: { NODE_ENV: "production" },
    },
    {
      name: "fpv-web",
      cwd: "/opt/FPVCarController/rc-car-control",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      env: { NODE_ENV: "production" },
    },
  ],
};
