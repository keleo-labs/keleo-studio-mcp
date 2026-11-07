Feature: Keleo Studio MCP access
  As an agent using Keleo Studio
  I want typed tools for its Apps Script API
  So that I can inspect and upload library content with the user's authority

  Background:
    Given a Keleo Studio web app deployment URL is configured

  Scenario: Apps Script token bridge
    Given the MCP server has no usable token
    When the agent starts authentication
    Then the MCP opens a Keleo Studio page in the user's browser
    And the user can complete Google sign-in if required
    And the page calls getPersonalApiToken through google.script.run
    And the page posts the token to the MCP's one-time loopback callback
    And the MCP validates the token with the packages API
    And the token is held only in the MCP process memory

  Scenario: Manual fallback
    Given the token bridge is not yet deployed or cannot complete
    When the agent starts manual authentication
    Then a local page opens in the user's browser
    And the page links to the deployment's API Reference
    And the user can submit their personal API token to the local server

  Scenario: Read the library
    Given the user has submitted a usable token
    When the agent lists packages or documents
    Then the server calls the matching query-parameter API endpoint with a bearer token
    And the JSON response is returned to the agent

  Scenario: Upload a package
    Given the user has submitted a usable token with create permission
    And a .keleo file exists on the MCP host
    When the agent uploads the file
    Then its bytes are sent as base64 text to the upload endpoint
    And the resulting bundle metadata is returned

  Scenario: Expired or rejected token
    Given the API rejects the submitted token or redirects to sign-in
    When the agent calls an API tool
    Then the tool reports that authentication must be repeated
    And the token is discarded from process memory
