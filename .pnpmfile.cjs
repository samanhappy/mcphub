module.exports = {
  hooks: {
    readPackage(pkg) {
      // MCPHub only uses GenAI embeddings, not its optional SDK v1 MCP adapter.
      if (pkg.name === '@google/genai') {
        delete pkg.peerDependencies?.['@modelcontextprotocol/sdk'];
        delete pkg.peerDependenciesMeta?.['@modelcontextprotocol/sdk'];
      }
      return pkg;
    },
  },
};
